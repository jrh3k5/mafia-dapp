const { expect } = require("chai");
const { ethers } = require("hardhat");
  
  describe("Mafia", function () {
    const civilianPlayerRole = 0n;
    const mafiaPlayerRole = 1n;

    const continuationPhaseOutcome = 0n;
    const civilianVictoryPhaseOutcome = 1n;
    const mafiaVictoryPhaseOutcome = 2n;

    let as;

    before(async function () {
      this.Mafia = await ethers.getContractFactory('Mafia');
    });
  
    beforeEach(async function () {
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

    it("successfully plays a game with 8 people", async function() {
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
      await this.accuse(hostPlayer, civ, mafia[1]);

      // mafia vote for civ[1]
      for(i = 0; i < mafia.length; i++) {

      }
    })
});
  