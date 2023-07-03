// contracts/Mafia.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

contract Mafia {
    mapping(address => GameState) games;
    mapping(address => PlayerStats) playerStats;

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
        mapping(address => Player) players;
        address[] playerAddresses;
        mapping(address => address) mafiaAccusations;
        mapping(address => address) murderVote;
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

    function accuseAsMafia(address hostAddress, address accused) public {
        GameState storage game = games[hostAddress];
        require(game.running == true, "game for host address must be running");
        require(game.players[msg.sender].walletAddress != address(0), "the sender must be a player participating in the game");
    }

    // cancelGame cancels the current game hosted by the sender, if it exists
    function cancelGame() public {
        delete games[msg.sender];
    }

    // getPlayers gets the list of players currently in the game hosted by the sender (if any).
    // This can be helpful if the game state does not have the expected number of players prior to starting.
    function getPlayers() public view returns(Player[] memory) {
        GameState storage game = games[msg.sender];
        address[] memory playerAddresses = game.playerAddresses;
        if (playerAddresses.length == 0) {
            return new Player[](0);
        }
        Player[] memory players = new Player[](playerAddresses.length);
        for(uint i = 0; i < playerAddresses.length; i++) {
            players[i] = game.players[playerAddresses[i]];
        }
        return players;
    }

    // joinGame tries to join the player to a game hosted by the given address.
    // This returns the player's current play stats.
    function joinGame(address hostAddress, string calldata playerNickname) public returns(PlayerStats memory) {
        GameState storage game = games[hostAddress];

        require(game.hostAddress != address(0), "a game must be started for the given host address to join");
        require(game.running == false, "a game cannot be joined while in progress");

        Player memory player = game.players[msg.sender];

        require(player.walletAddress == address(0), "a game cannot be joined again");

        game.playerAddresses.push(msg.sender);

        player.walletAddress = hostAddress;
        player.nickname = playerNickname;

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
}