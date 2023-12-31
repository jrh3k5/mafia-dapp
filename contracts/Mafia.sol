// contracts/Mafia.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

contract Mafia {
    mapping(address => GameState) games;

    // Store this game state separately from the rest of the game state to avoid storage declarations
    mapping(address => Player[]) gamePlayers;
    mapping(address => mapping(address => address)) mafiaAccusations;
    mapping(address => mapping(address => uint)) mafiaAccusationCounts;
    mapping(address => mapping(address => address)) murderVote;
    mapping(address => mapping(address => uint)) murderVoteCounts;

    struct GameState {
        address hostAddress;
        bool running;
        address[] playerAddresses;
        TimeOfDay currentPhase;
        PhaseOutcome lastPhaseOutcome;
    }

    struct Player {
        address walletAddress;
        string nickname; // a human-readable nickname of the player
        bool dead; // true if the player has been killed by the Mafia
        bool convicted; // true if the players have voted this player out as Mafia
        PlayerRole playerRole; // what type of character the player is in the game
    }

    struct PlayerListItem {
        address walletAddress;
        string nickname;
    }

    enum TimeOfDay {
        Day, Night
    }

    enum PlayerRole {
        Civilian, Mafia
    }

    enum PhaseOutcome {
        // there is no current victor - continue
        Continuation,
        // the civilians have won
        CivilianVictory, 
        // the Mafia has won
        MafiaVictory
    }

    // GameInitialized describes the initialization of a game
    event GameInitialized(address indexed hostAddress);
    // GameJoined describes a player joining a host's game
    event GameJoined(address indexed hostAddress, address indexed playerAddress);
    // GameStarted describes the start of a game
    event GameStarted(address indexed hostAddress);
    // GamePhaseExecuted is emitted when the host of a game successfully concludes a phase.
    // The PhaseOutcome describes the outcome of the phase execution (victory? continuation?),
    // TimeOfDay describes the time of day of the phase that was executed,
    // and playersKilled and playersConvicted describes players killed by Mafia and convicted of being Mafia, respectively.
    event GamePhaseExecuted(address indexed hostAddress, uint phaseOutcome, uint timeOfDay, address[] playersKilled, address[] playersConvicted);

    // accuseAsMafia records the sender accusing the given accused as being a Mafia member
    function accuseAsMafia(address hostAddress, address accused) public {
        GameState memory game = games[hostAddress];
        require(game.running == true, "game for host address must be running");
        require(game.currentPhase == TimeOfDay.Day, "Mafia accusations can only be made during the day");
        require(game.lastPhaseOutcome == PhaseOutcome.Continuation, "Mafia accusations cannot be submitted on games that have finished");

        (Player memory accuserPlayer, bool hasAccuser) = getGamePlayer(hostAddress, msg.sender);
        require(hasAccuser && isPlayerActive(accuserPlayer), "the accuser must be a player participating in the game");
        
        (Player memory accusedPlayer, bool hasAccused) = getGamePlayer(hostAddress, accused);
        require(hasAccused && isPlayerActive(accusedPlayer), "the accused must be a player participating in the game");

        mafiaAccusations[hostAddress][msg.sender] = accused;
        mafiaAccusationCounts[hostAddress][accused]++;
    }

    // cancelGame cancels the current game hosted by the sender, if it exists
    function cancelGame() public {
        clearGameState();
    }

    // executePhase executes the current phase of the game
    function executePhase() public {
        GameState storage game = games[msg.sender];
        require(game.hostAddress != address(0), "no game found hosted by current sender");
        require(game.running, "the game must be running");

        PhaseOutcome outcome;
        address[] memory killedPlayers;
        address[] memory convictedPlayers;
        TimeOfDay currentPhase = game.currentPhase;
        TimeOfDay nextPhase;
        if (currentPhase == TimeOfDay.Day) {
            (outcome, convictedPlayers) = executeDayPhase(game);
            killedPlayers = new address[](0);
            nextPhase = TimeOfDay.Night;
        } else if (game.currentPhase == TimeOfDay.Night) {
            (outcome, killedPlayers) = executeNightPhase(game);
            convictedPlayers = new address[](0);
            nextPhase = TimeOfDay.Day;
        } else {
            // not sure how this happens, but, just in case...
            revert("game current phase is neither Day nor Night");
        }

        game.currentPhase = nextPhase;
        game.lastPhaseOutcome = outcome;

        uint phaseOutcomeInt;
        if (outcome == PhaseOutcome.CivilianVictory) {
            phaseOutcomeInt = 1;
        } else if (outcome == PhaseOutcome.MafiaVictory) {
            phaseOutcomeInt = 2;
        }

        uint currentPhaseInt;
        if (currentPhase == TimeOfDay.Night) {
            currentPhaseInt = 1;
        }

        emit GamePhaseExecuted(game.hostAddress, phaseOutcomeInt, currentPhaseInt, killedPlayers, convictedPlayers);
    }

    // finishGame is invoked when the game has concluded
    function finishGame() public {
        clearGameState();
    }

    // getPlayerList gets the list of players in a game hosted by the given address, consisting only of information
    // that other players can use without betraying player secrets (such as role).
    function getPlayerList(address hostAddress) public view returns(PlayerListItem[] memory) {
        Player[] memory players = gamePlayers[hostAddress];
        PlayerListItem[] memory playerList = new PlayerListItem[](players.length);
        for(uint i = 0; i < players.length; i++) {
            Player memory player = players[i];
            playerList[i] = PlayerListItem({
                walletAddress: player.walletAddress,
                nickname: player.nickname
            });
        }
        return playerList;
    }

    // getSelfPlayerInfo returns the player's own information for a game hosted by the given host address
    function getSelfPlayerInfo(address hostAddress) public view returns(Player memory) {
        (Player memory player, bool hasPlayer) = getGamePlayer(hostAddress, msg.sender);
        require(hasPlayer, "player not found in given host's game");
        return player;
    }

    // initializes a new game with the sender being the host
    // call cancelGame() if another game is already in progress
    function initializeGame() public {
        GameState storage game = games[msg.sender];

        require(game.hostAddress == address(0), "a game cannot be initialized while you are hosting another");
        
        game.hostAddress = msg.sender;
        emit GameInitialized(msg.sender);
    }

    // joinGame tries to join the player to a game hosted by the given address.
    function joinGame(address hostAddress, string calldata playerNickname) public {
        GameState storage game = games[hostAddress];

        require(game.hostAddress != address(0), "a game must be started for the given host address to join");
        require(game.running == false, "a game cannot be joined while in progress");

        (,bool hasJoiner) = getGamePlayer(hostAddress, msg.sender);
        require(!hasJoiner, "a game cannot be joined again");

        game.playerAddresses.push(msg.sender);

        gamePlayers[hostAddress].push(Player(msg.sender, playerNickname, false, false, PlayerRole.Civilian));

        emit GameJoined(hostAddress, msg.sender);
    }

    // startGame starts the game.
    // This ensures that the game has the number of expected players.
    function startGame(uint expectedPlayerCount) public {
        GameState storage game = games[msg.sender];

        require(game.hostAddress != address(0), "you must have initialized a game");
        require(game.running == false, "a game cannot be started while already in progress");
        // use expectedPlayerCount as a proxy here to save a little bit, since it'll be compared to the actual player count
        require(expectedPlayerCount >= 3, "a game requires at least three players");
        require(game.playerAddresses.length == expectedPlayerCount, "game does not match the expected number of players");

        game.running = true;
        game.currentPhase = TimeOfDay.Day;

        // shuffle in-memory a list of players and then assign the first 20% of them as Mafia members (minimum 1)
        Player[] storage sourcePlayers = gamePlayers[game.hostAddress];
        Player[] memory playersCopy = new Player[](sourcePlayers.length);
        for(uint i = 0; i < sourcePlayers.length; i++) {
            playersCopy[i] = sourcePlayers[i];
        }

        for (uint i = 0; i < playersCopy.length; i++) {
            uint n = i + uint(keccak256(abi.encodePacked(block.timestamp))) % (playersCopy.length - i);
            Player memory temp = playersCopy[n];
            playersCopy[n] = playersCopy[i];
            playersCopy[i] = temp;
        }

        uint mafiaPlayerCount = (playersCopy.length + 4) / 5;
        for(uint i = 0; i <  playersCopy.length; i++) {
            if (i < mafiaPlayerCount) {
                playersCopy[i].playerRole = PlayerRole.Mafia;
            } else {
                playersCopy[i].playerRole = PlayerRole.Civilian;
            }
        }

        for(uint i = 0; i < sourcePlayers.length; i++) {
            Player storage sourcePlayer = sourcePlayers[i];
            for(uint j = 0; j < playersCopy.length; j++) {
                Player memory playerCopy = playersCopy[j];
                if (playerCopy.walletAddress == sourcePlayer.walletAddress) {
                    sourcePlayer.playerRole = playerCopy.playerRole;
                    break;
                }
            }
        }

        emit GameStarted(msg.sender);
    }

    // voteToKill is used to submit a vote to kill another player.
    function voteToKill(address hostAddress, address victimAddress) public {
        GameState memory game = games[hostAddress];
        require(game.running == true, "game for host address must be running");
        require(game.currentPhase == TimeOfDay.Night, "votes to kill can only be submitted at night");
        require(game.lastPhaseOutcome == PhaseOutcome.Continuation, "votes to kill cannot be submitted on games that have finished");

        (Player memory player, bool hasPlayer) = getGamePlayer(hostAddress, msg.sender);
        require(hasPlayer, "the voting player must be a participant in the game");
        require(player.playerRole == PlayerRole.Mafia, "only Mafia members can submit votes to kill");
        require(isPlayerActive(player), "votes to kill cannot be submitted by non-participating players");
        
        (Player memory victimPlayer, bool hasVictim) = getGamePlayer(hostAddress, victimAddress);
        require(hasVictim && isPlayerActive(victimPlayer), "the proposed murder victim must be participating in the game");
        require(victimPlayer.playerRole != PlayerRole.Mafia, "Mafia players cannot be targeted for murder");
        
        mapping(address => address) storage gameVotes = murderVote[hostAddress];
        require(gameVotes[player.walletAddress] == address(0), "only one vote to kill each round can be submitted");
        gameVotes[player.walletAddress] = victimAddress;
        murderVoteCounts[hostAddress][victimAddress]++;
    }

    // private functions

    function clearGameState() private {
        Player[] memory players = gamePlayers[msg.sender];

        for (uint i = 0; i < players.length; i++ ) {
            address playerAddress = players[i].walletAddress;
            delete mafiaAccusations[msg.sender][playerAddress];
            delete mafiaAccusationCounts[msg.sender][playerAddress];
            delete murderVote[msg.sender][playerAddress];
            delete murderVoteCounts[msg.sender][playerAddress];
        }

        delete gamePlayers[msg.sender];
        delete games[msg.sender];
    }

    // executeDayPhase tallies the vote to evict someone from the game due to Mafia accusation.
    // It returns the outcome of the phase execution and the addresses of any players that have been convicted of being Mafia.
    function executeDayPhase(GameState storage game) private returns (PhaseOutcome, address[] memory) {
        mapping(address => uint) storage voteCounts = mafiaAccusationCounts[game.hostAddress];

        Player[] memory players = gamePlayers[game.hostAddress];
        uint highestVote;
        address convicted;
        uint livingPlayerCount;
        uint voteCount;
        uint numberOfReceivers;
        for(uint i = 0; i < players.length; i++) {
            Player memory player = players[i];
            if (!isPlayerActive(player)) {
                // don't count votes by dead or convicted players
                continue;
            }
            livingPlayerCount++;

            address playerAddress = players[i].walletAddress;
            // Account for the possibility that a player's vote was missed
            if (mafiaAccusations[game.hostAddress][playerAddress] != address(0)) {
                voteCount++;

                uint accusations = voteCounts[playerAddress];
                if (accusations > highestVote) {
                    numberOfReceivers = 1;
                    highestVote = accusations;
                    convicted = playerAddress;
                } else if (accusations == highestVote) {
                    numberOfReceivers++;
                }
            }
        }

        require(livingPlayerCount == voteCount, "one or more players have not voted");
        require(convicted != address(0), "at least one player should have been voted for being Mafia");

        // only convict the player if there's no tie
        if (numberOfReceivers > 1) {
            return (PhaseOutcome.Continuation, new address[](0));
        } 
        
        getWritableGamePlayer(game.hostAddress, convicted).convicted = true;

        mapping(address => address) storage accusationVotes = mafiaAccusations[game.hostAddress];

        uint activeMafiaPlayerCount;
        uint activeCivilianPlayerCount;
        for(uint i = 0; i < players.length; i++) {
            Player memory player = players[i];
            
            // Zero out all the votes so that the next reflects the true vote counts
            delete voteCounts[player.walletAddress];
            delete accusationVotes[player.walletAddress];

            if (isPlayerActive(player) && player.walletAddress != convicted) {
                if (player.playerRole == PlayerRole.Mafia) {
                    activeMafiaPlayerCount++;
                } else {
                    activeCivilianPlayerCount++;
                }
            }
        }

        address[] memory convictedPlayers = new address[](1);
        convictedPlayers[0] = convicted;

        // If all Mafia have been convicted, the civilians win
        if (activeMafiaPlayerCount == 0) {
            return (PhaseOutcome.CivilianVictory, convictedPlayers);
        } else if (activeCivilianPlayerCount <= activeMafiaPlayerCount) {
            return (PhaseOutcome.MafiaVictory, convictedPlayers);
        }

        return (PhaseOutcome.Continuation, convictedPlayers);
    }

    // executeNightPhase tallies the murder counts and determines if the Mafia players have won.
    // This returns the phase outcome of the execution and the addresses of any players that have been killed.
    function executeNightPhase(GameState storage game) private returns(PhaseOutcome, address[] memory) {
        mapping(address => uint) storage voteCounts = murderVoteCounts[game.hostAddress];

        Player[] memory players = gamePlayers[game.hostAddress];
        uint highestVoteCount;
        address murderVictim;
        uint numberOfReceivers;
        for (uint i = 0; i < players.length; i++) {
            address playerAddress = players[i].walletAddress;
            uint playerVotes = voteCounts[playerAddress];
            if (playerVotes > highestVoteCount) {
                numberOfReceivers = 1;
                highestVoteCount = playerVotes;
                murderVictim = playerAddress;
            } else if (playerVotes == highestVoteCount) {
                numberOfReceivers++;
            }
        }

        require(murderVictim != address(0), "a murder victim should have been selected");

        // Only kill someone if there wasn't a tie
        if (numberOfReceivers > 1) {
            return (PhaseOutcome.Continuation, new address[](0));
        }

        getWritableGamePlayer(game.hostAddress, murderVictim).dead = true;

        mapping(address => address) storage murderTargets = murderVote[game.hostAddress];

        uint activeCivilians;
        uint activeMafia;
        for (uint i = 0; i < players.length; i++) {
            Player memory player = players[i];

            // Zero out the player's votes so that the next phase doesn't double-count them
            voteCounts[player.walletAddress] = 0;
            murderTargets[player.walletAddress] = address(0);

            if (isPlayerActive(player) && player.walletAddress != murderVictim) {
                if (player.playerRole == PlayerRole.Civilian) {
                    activeCivilians++;
                } else if (player.playerRole == PlayerRole.Mafia) {
                    activeMafia++;
                }
            }
        }

        address[] memory killedPlayers = new address[](1);
        killedPlayers[0] = murderVictim;

        // If there aren't enough civilians to defeat a Mafia expulsion vote,
        // then the Mafia has won
        if (activeCivilians <= activeMafia) {
            return (PhaseOutcome.MafiaVictory, killedPlayers);
        } else if (activeMafia == 0) {
            // Not sure how this could come about - a Mafia voting to kill themselves? Whatever.
            return (PhaseOutcome.CivilianVictory, killedPlayers);
        }

        return (PhaseOutcome.Continuation, killedPlayers);
    }

    // getGamePlayer gets the player for the given player address for a game hosted by the given host address, if it can be found.
    function getGamePlayer(address hostAddress, address playerAddress) private view returns(Player memory, bool) {
        Player[] memory playerInfos = gamePlayers[hostAddress];
        if (playerInfos.length == 0) {
            return (Player(address(0), "", false, false, PlayerRole.Civilian), false);
        }
        for(uint i = 0; i < playerInfos.length; i++) {
            if (playerInfos[i].walletAddress == playerAddress) {
                return (playerInfos[i], true);
            }
        }
        return (Player(address(0), "", false, false, PlayerRole.Civilian), false);
    }

    // getWritableGamePlayer gets a storage Player reference for a state change to be persisted.
    // If the given player address does not exist in the game for the given address, the transaction is reverted.
    function getWritableGamePlayer(address hostAddress, address playerAddress) private view returns(Player storage) {
        Player[] storage playerInfos = gamePlayers[hostAddress];
        if (playerInfos.length == 0) {
            revert("game has no players; no players can be written to");
        }
        for(uint i = 0; i < playerInfos.length; i++) {
            if (playerInfos[i].walletAddress == playerAddress) {
                return playerInfos[i];
            }
        }
        revert("no player found for given address for writing");
    }

    // isPlayerActive determines if the player is active and can participate in the game
    function isPlayerActive(Player memory player) private pure returns(bool) {
        return !player.dead && !player.convicted;
    }

    // requireActive will revert if the given player is unable to participate in the game
    function requireActive(Player memory player) private pure {
        require(isPlayerActive(player), "player must be active");
    }
}