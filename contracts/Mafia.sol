// contracts/Mafia.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

contract Mafia {
    mapping(address => GameState) games;
    mapping(address => PlayerStats) playerStats;

    // Store this game state separately from the rest of the game state to avoid storage declarations
    mapping(address => Player[]) gamePlayers;
    mapping(address => mapping(address => address)) mafiaAccusations;
    mapping(address => mapping(address => address)) murderVote;

    struct JoinResponse {
        PlayerStats stats; // give the user's stats back to them when they join a game
    }

    struct PlayerStats {
        int citizenTimes; // the number of times the player has played as a citizen
        int mafiaTimes; // the number of times the player has played as a Mafia member
        int killCount; // the number of time the player has voted for someone to die and that person has died
        int mafiaTrueAccusations; // the number of times a player has identified a Mafia member - even if they didn't win the majority of the vote
        int mafiaFalseAccusations; // the number of times a player has accused someone of being a Mafia member and they weren't
        int deathCount; // the number of times the player has been murdered by the Mafia
        int convictedMafia; // the number of times the player has voted for and successfully convicted a Mafia member
        int wrongfullyAccused; // the number of times the player has been wrongfully accused (convicted or not) or being a Mafia member
        int correctlyAccused; // the number of times the player has been rightly accused of being a Mafia member
        int playCount; // the number of games the player has played (hosted or otherwise)
        int hostCount; // the number of games the player has hosted
    }

    struct GameState {
        address hostAddress;
        bool running;
        address[] playerAddresses;
        TimeOfDay currentPhase;
    }

    struct Player {
        address walletAddress;
        string nickname; // a human-readable nickname of the player
        bool alive; // true if the player has not been killed by the Mafia
        bool convictedMafia; // true if the players have voted this player out as mafia
    }

    enum TimeOfDay {
        Day, Night
    }

    // accuseAsMafia records the sender accusing the given accused as being a Mafia member
    function accuseAsMafia(address hostAddress, address accused) public {
        GameState memory game = games[hostAddress];
        require(game.running == true, "game for host address must be running");
        require(game.currentPhase == TimeOfDay.Day, "Mafia accusations can only be made during the day");

        require(isInGame(hostAddress, msg.sender), "the sender must be a player participating in the game");

        // save some $$$ and don't check to see if the accused is a member of this game - no harm beyond the player wasting their vote

        mafiaAccusations[hostAddress][msg.sender] = accused;
    }

    // cancelGame cancels the current game hosted by the sender, if it exists
    function cancelGame() public {
        delete games[msg.sender];
    }

    // getPlayers gets the list of players currently in the game hosted by the sender (if any).
    // This can be helpful if the game state does not have the expected number of players prior to starting.
    function getPlayers() public view returns(Player[] memory) {
        return gamePlayers[msg.sender];
    }

    // joinGame tries to join the player to a game hosted by the given address.
    // This returns the player's current play stats.
    function joinGame(address hostAddress, string calldata playerNickname) public returns(PlayerStats memory) {
        GameState storage game = games[hostAddress];

        require(game.hostAddress != address(0), "a game must be started for the given host address to join");
        require(game.running == false, "a game cannot be joined while in progress");

        (Player memory player, bool hasPlayer) = getGamePlayer(hostAddress, msg.sender);

        require(!hasPlayer, "a game cannot be joined again");

        game.playerAddresses.push(msg.sender);

        player.walletAddress = hostAddress;
        player.nickname = playerNickname;

        gamePlayers[hostAddress].push(player);

        return playerStats[msg.sender];
    }

    // initializes a new game with the sender being the host
    // call cancelGame() if another game is already in progress
    function initializeGame() public {
        GameState storage game = games[msg.sender];

        require(game.hostAddress == address(0), "a game cannot be initialized while you are hosting another");
        game.hostAddress = msg.sender;
    }

    // startGame starts the game.
    // This ensures that the game has the number of expected players.
    function startGame(uint expectedPlayerCount) public {
        GameState storage game = games[msg.sender];

        require(game.hostAddress != address(0), "you must have initialized a game");
        require(game.running == false, "a game cannot be joined while in progress");
        // use expectedPlayerCount as a proxy here to save a little bit, since it'll be compared to the actual player count
        require(expectedPlayerCount >= 5, "a game requires at least five players");
        require(game.playerAddresses.length == expectedPlayerCount, "game does not match the expected number of players");

        game.running = true;
        game.currentPhase = TimeOfDay.Day;

        // TODO: assign civilian/mafia roles
    }

    // voteToKill is used to submit a vote to kill another player.
    function voteToKill(address hostAddress, address victimAddress) public {
        GameState memory game = games[hostAddress];
        require(game.running == true, "game for host address must be running");
        require(game.currentPhase == TimeOfDay.Night, "Votes to kill can only be submitted at night");

        require(isInGame(hostAddress, msg.sender), "the voting player must be a participant in the game");

        // TODO: enforce Mafia role of sender

        murderVote[hostAddress][msg.sender] = victimAddress;
    }

    // private functions

    // getGamePlayer gets the player for the given player address for a game hosted by the given host address, if it can be found.
    function getGamePlayer(address hostAddress, address playerAddress) private view returns(Player memory, bool) {
        Player[] memory playerInfos = gamePlayers[hostAddress];
        if (playerInfos.length == 0) {
            return (Player(address(0), "", false, false), false);
        }
        for(uint i = 0; i < playerInfos.length; i++) {
            if (playerInfos[i].walletAddress == playerAddress) {
                return (playerInfos[i], true);
            }
        }
        return (Player(address(0), "", false, false), false);
    }

    // isInGame determines if the given player address is participating in a game hosted by the given host address
    function isInGame(address hostAddress, address playerAddress) private view returns (bool) {
        Player[] memory playerInfos = gamePlayers[hostAddress];
        if (playerInfos.length == 0) {
            return false;
        }
        for(uint i = 0; i < playerInfos.length; i++) {
            if (playerInfos[i].walletAddress == playerAddress) {
                return true;
            }
        }
        return false;
    }
}