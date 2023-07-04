const { expect } = require("chai");
const { ethers } = require("hardhat");
  
  describe("Mafia", function () {
    const civilianPlayerRole = 0n;
    const mafiaPlayerRole = 1n;

    const continuationPhaseOutcome = 0n;
    const civilianVictoryPhaseOutcome = 1n;
    const mafiaVictoryPhaseOutcome = 2n;

    let as;

    before(async () => {
      this.Mafia = await ethers.getContractFactory('Mafia');
    });
  
    beforeEach(async () => {
      this.mafia = await this.Mafia.deploy();
      as = address => this.mafia.connect(address);

      this.newPlayers = async playerCount => {
        if (playerCount > 10) {
          throw "unable to fulfill request; too many players";
        }
          // Is there a better way to do this? Probably. Do I want to figure that out? Not right now.
        const [player0, player1, player2, player3, player4, player5, player6, player7, player8, player9] = await ethers.getSigners();
        const createdPlayers = [player0, player1, player2, player3, player4, player5, player6, player7, player8, player9];
        let selectedPlayers = []
        createdPlayers.forEach(player => {
          if (selectedPlayers.length >= playerCount) {
            return;
          }
          selectedPlayers.push(player);
        })
        return selectedPlayers;
      };

      this.joinGame = async (hostAddress, playerAddresses) => {
        for (i = 0; i < playerAddresses.length; i++) {
          await as(playerAddresses[i]).joinGame(hostAddress, `Player ${i}`);
        };
      };

      this.getGameState = async hostAddress => {
        gameState = await as(hostAddress).getGameState();
        return {
          lastPhaseOutcome: gameState[5],
          convictedPlayers: gameState[6],
          killedPlayers: gameState[7]
        };
      };

      this.getSelfInfo = async (hostAddress, playerAddress) => {
        selfInfo = await as(playerAddress).getSelfPlayerInfo(hostAddress);
        return {
          nickname: selfInfo[1],
          dead: selfInfo[2],
          convicted: selfInfo[3],
          playerRole: selfInfo[4],
        }
      };

      // returns mafia, then civ
      this.getFactions = async (hostAddress, playerAddresses) => {
        let mafia = [];
        let civ = [];
        for (i = 0; i < playerAddresses.length; i++) {
          playerAddress = playerAddresses[i];
          selfInfo = await this.getSelfInfo(hostAddress,playerAddress);
          switch(selfInfo.playerRole) {
            case civilianPlayerRole:
              civ.push(playerAddress);
              break;
            case mafiaPlayerRole:
              mafia.push(playerAddress);
              break;
          }
        }
        return [mafia, civ];
      };

      this.accuse = async (hostAddress, accuserAddresses, accusedAddress) => {
        for(let i = 0; i < accuserAddresses.length; i++) {
          const accuser = accuserAddresses[i];
          const selfInfo = await this.getSelfInfo(hostAddress, accuser);
          if (selfInfo.dead || selfInfo.convicted) {
            // dead and convicted users can't vote
            continue;
          }

          await as(accuser).accuseAsMafia(hostAddress, accusedAddress);
        }
      };

      this.voteToKill = async (hostAddress, voters, toKill) => {
        for(let i = 0; i < voters.length; i++) {
          const voter = voters[i];
          const selfInfo = await this.getSelfInfo(hostAddress, voter);
          if (selfInfo.dead || selfInfo.convicted) {
            // dead and convicted users can't vote
            continue;
          }

          await as(voter).voteToKill(hostAddress, toKill);
        }
      };
    });

    it("successfully plays a game with 8 people", async () => {
      // const [player0, player1, player2, player3, player4, player5, player6, player7] = await ethers.getSigners();
      // const allPlayers = [player0, player1, player2, player3, player4, player5, player6, player7];
      const allPlayers = await this.newPlayers(8);

      // Choose someone other than the contract deployer as host to help avoid accidentally treating the deployer as the host
      // const hostPlayer = player4;
      const hostPlayer = allPlayers[4];

      await as(hostPlayer).initializeGame();

      await this.joinGame(hostPlayer, allPlayers);
      
      await as(hostPlayer).startGame(allPlayers.length);

      for (i = 0; i < allPlayers.length; i++) {
        const selfInfo = await this.getSelfInfo(hostPlayer, allPlayers[i]);
        expect(selfInfo.nickname).to.eq(`Player ${i}`, "the player should have the correct nickname stored");
        expect(selfInfo.dead).to.eq(false, "the player should not be dead");
        expect(selfInfo.convicted).to.eq(false, "the player should not yet be evicted from the game");
        expect(selfInfo.playerRole, "the player should have a player type").to.be.oneOf([civilianPlayerRole, mafiaPlayerRole]);
      }

      const [mafia, civ] = await this.getFactions(hostPlayer, allPlayers);

      expect(mafia).to.have.length(2, "1 for every 4 players, rounded up, Mafia players should be assigned");
      expect(civ).to.have.length(6, "the remaining players should be civilians");

      // uncomment to get a list of addresses for troubleshooting
      // mafia.forEach((player, index) => {
      //   console.log(`mafia[${index}] = ${player.address}`);
      // });
      // civ.forEach((player, index) => {
      //   console.log(`civ[${index}] = ${player.address}`);
      // });

      // initial Mafia vote: civ[0], civ[1], civ[3], civ[5], mafia[0] => civ[2], evicting them
      await this.accuse(hostPlayer, [civ[0], civ[1], civ[3], civ[5], mafia[0]], civ[2]);
      await this.accuse(hostPlayer, [civ[2], civ[4], mafia[1]], civ[1]);

      await as(hostPlayer).executePhase();

      let gameState = await this.getGameState(hostPlayer);
      expect(gameState.convictedPlayers[0]).to.equal(civ[2].address, "civ[2] should have been convicted");
      expect(gameState.lastPhaseOutcome).to.equal(continuationPhaseOutcome, "the game should continue");

      // Mafia should vote to kill civ[0]
      await this.voteToKill(hostPlayer, mafia, civ[0]);

      // tally the kill votes
      await as(hostPlayer).executePhase();

      gameState = await this.getGameState(hostPlayer);
      expect(gameState.killedPlayers[0]).to.equal(civ[0].address, "civ[0] should have been murdered");
      expect(gameState.lastPhaseOutcome).to.equal(continuationPhaseOutcome, "the game should continue");

      // civ[2] dead, civ[0] convicted; remaining civilians vote to expel mafia[1]
      // active civs: 4, active mafia: 2
      await this.accuse(hostPlayer, civ, mafia[1]);

      // mafia vote for civ[1]
      await this.accuse(hostPlayer, mafia, civ[1]);

      await as(hostPlayer).executePhase();

      gameState = await this.getGameState(hostPlayer);
      expect(gameState.convictedPlayers[0]).to.equal(civ[2].address, "civ[2] should still be convicted");
      expect(gameState.convictedPlayers[1]).to.equal(mafia[1].address, "mafia[1] should have been convicted as Mafia");
      expect(gameState.lastPhaseOutcome).to.equal(continuationPhaseOutcome, "the conviction of mafia[1] should not end the game");

      await this.voteToKill(hostPlayer, [mafia[0]], civ[3]);

      await as(hostPlayer).executePhase();

      // civ[2] and civ[3] dead; civ[0] and mafia[1] convicted
      // If remaining civilians vote for mafia[0] as Mafia, then they should win
      await this.accuse(hostPlayer, [civ[1], civ[4], civ[5]], mafia[0]);
      await this.accuse(hostPlayer, [mafia[0]], civ[1]);

      await as(hostPlayer).executePhase();

      gameState = await this.getGameState(hostPlayer);
      expect(gameState.convictedPlayers).to.contain(mafia[0].address, "mafia[0] should have been convicted as Mafia");
      expect(gameState.lastPhaseOutcome).to.equal(civilianVictoryPhaseOutcome, "civilians should have won because all Mafia are out of the game");

      await as(hostPlayer).finishGame();
    })

    describe("starting a game", async () => {
      it("should generate enough faction sizes for a minimally-sized game", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        const [mafia, civ] = await this.getFactions(players[0], players);
        expect(mafia).to.have.length(1, "a single Mafia player should have been assigned");
        expect(civ).to.have.length(2, "two civilians should have been assigned");
      })

      it("should disallow games with fewer than three players", async () => {
        const players = await this.newPlayers(2);
  
        await as(players[0]).initializeGame();
  
        await this.joinGame(players[0], players);
  
        await expect(as(players[0]).startGame(players.length)).to.be.revertedWith("a game requires at least three players");
      })

      it("should disallow starting a game when none has been initialized", async () => {
          const players = await this.newPlayers(1);

          await expect(as(players[0]).startGame(1)).to.be.revertedWith("you must have initialized a game");
      })

      it("should disallow starting a game twice", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);
        await expect(as(players[0]).startGame(players.length)).to.be.revertedWith("a game cannot be started while already in progress");
      })

      it("should fail to start if the number of players joined does not match the expected count", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], [players[0], players[1]]);
        await expect(as(players[0]).startGame(players.length)).to.be.revertedWith("game does not match the expected number of players");

      })
    })

    describe("accusing someone of being mafia", async () => {
      it("should not allow an accusation if the game has not been started", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);

        await expect(as(players[1]).accuseAsMafia(players[0], players[2])).to.be.revertedWith("game for host address must be running");
      })

      it("should not allow voting at night", async () => {
        const players = await this.newPlayers(4);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        await this.accuse(players[0], players, players[1]);

        await as(players[0]).executePhase();

        // Now it should be night - try to vote
        await expect(as(players[2]).accuseAsMafia(players[0], players[1])).to.be.revertedWith("Mafia accusations can only be made during the day");
      })

      it("should not allow an accusation against an address outside of the players in the game", async () => {
        const players = await this.newPlayers(4);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], [players[0], players[1], players[2]]);
        await as(players[0]).startGame(players.length - 1);

        await expect(as(players[1]).accuseAsMafia(players[0], players[3])).to.be.revertedWith("the accused must be a player participating in the game");
      })

      it("should not allow accusations by non-players", async () => {
        const players = await this.newPlayers(4);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], [players[0], players[1], players[2]]);
        await as(players[0]).startGame(players.length - 1);

        await expect(as(players[3]).accuseAsMafia(players[0], players[1])).to.be.revertedWith("the accuser must be a player participating in the game");
      })
    })

    describe("cancelling a game", async () => {
      it("should allow for a new game to be started", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame()
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        await as(players[0]).cancelGame();

        // Start a new game and verify it can be played to completion by expelling a civilian
        await as(players[0]).initializeGame()
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        const [mafia, civ] = await this.getFactions(players[0], players);

        await this.accuse(players[0], [mafia[0], civ[1]], civ[0]);
        await this.accuse(players[0], [civ[0]], mafia[0]);

        await as(players[0]).executePhase();

        const gameState = await this.getGameState(players[0]);
        expect(gameState.lastPhaseOutcome).to.equal(mafiaVictoryPhaseOutcome);

        await as(players[0]).finishGame();
      })
    })
});
  