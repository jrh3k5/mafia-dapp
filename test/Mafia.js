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

      it("disallows accusing dead people", async() => {
        const players = await this.newPlayers(9);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        const [mafia, civ] = await this.getFactions(players[0], players);

        await this.accuse(players[0], civ, civ[0]);
        await this.accuse(players[0], mafia, civ[0]);

        await as(players[0]).executePhase();

        const killed = civ[1];
        await this.voteToKill(players[0], mafia, killed);

        await as(players[0]).executePhase();

        await expect(as(mafia[0]).accuseAsMafia(players[0], killed)).to.be.revertedWith("dead players cannot be accused of being Mafia");
      })

      it("disallows accusing people who have already been convicted", async () => {
        const players = await this.newPlayers(4);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        const [mafia, civ] = await this.getFactions(players[0], players);

        await this.accuse(players[0], civ, civ[0]);
        await this.accuse(players[0], mafia, civ[0]);

        await as(players[0]).executePhase();
        await this.voteToKill(players[0], mafia, civ[1]);

        await as(players[0]).executePhase();

        await expect(as(civ[1]).accuseAsMafia(players[0], civ[0])).to.be.revertedWith("convicted players cannot be accused of being Mafia");
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

    describe("joining a game", async () => {
      it("should disallow joining to a game that has not been initialized", async () => {
          const players = await this.newPlayers(2);
          await expect(as(players[0]).joinGame(players[1], "not inited")).to.be.revertedWith("a game must be started for the given host address to join");
      })

      it("should disallow joining a game that has started", async() => {
        const players = await this.newPlayers(4);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], [players[0], players[1], players[2]]);
        await as(players[0]).startGame(players.length - 1);
        await expect(as(players[3]).joinGame(players[0], "rejected :(")).to.be.revertedWith("a game cannot be joined while in progress");
      })

      it("should disallow joining the same game again", async () => {
        const players = await this.newPlayers(2);
        await as(players[1]).initializeGame();
        await as(players[0]).joinGame(players[1], "initial join");
        await expect(as(players[0]).joinGame(players[1], "re-joining")).to.be.revertedWith("a game cannot be joined again");
      })
    })

    describe("voting to kill", async () => {
      it("should mark the player as dead", async () => {
        const players = await this.newPlayers(5);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);

        const [mafia, civ] = await this.getFactions(players[0], players);

        // Get to night
        await this.accuse(players[0], civ, civ[0]);
        await this.accuse(players[0], mafia, civ[0]);

        await as(players[0]).executePhase();

        await this.voteToKill(players[0], mafia, civ[1]);

        await as(players[0]).executePhase();

        const selfInfo = await this.getSelfInfo(players[0], civ[1]);
        expect(selfInfo.dead).to.be.true;
      })

      it("disallows voting to kill in a game that is not running", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await expect(as(players[0]).voteToKill(players[0], players[1])).to.be.revertedWith("game for host address must be running");
      })

      it("only allows voting at night", async () => {
        const players = await this.newPlayers(3);
        await as(players[0]).initializeGame();
        await this.joinGame(players[0], players);
        await as(players[0]).startGame(players.length);
        
        const [mafia, civ] = await this.getFactions(players[0], players);
        await expect(as(mafia[0]).voteToKill(players[0], civ[0])).to.be.revertedWith("votes to kill can only be submitted at night");
      })

      describe("at night", async () => {
        let players;
        let mafia;
        let civ;

        beforeEach(async () => {
          players = await this.newPlayers(9);
          await as(players[0]).initializeGame();
          await this.joinGame(players[0], players);
          await as(players[0]).startGame(players.length);

          [mafia, civ] = await this.getFactions(players[0], players);

          // Evict one of the civilians to set us up for being in night
          await this.accuse(players[0], civ, civ[civ.length - 1]);
          await this.accuse(players[0], mafia, civ[civ.length - 1]);

          // transition to night
          await as(players[0]).executePhase();
        })

        it("disallows voting to kill someone who isn't in the game", async () => {
          const withNewPlayer = await this.newPlayers(players.length+1);
          await expect(as(mafia[0]).voteToKill(players[0], withNewPlayer[withNewPlayer.length - 1])).to.be.revertedWith("the proposed murder victim must be a player in the game");
        })

        it("only allows voting by a mafia player", async () => {
          await expect(as(civ[0]).voteToKill(players[0], civ[1])).to.be.revertedWith("only Mafia members can submit votes to kill");
        })

        it("disallows voting to kill dead people", async() => {
          const killed = civ[civ.length - 2];
          await this.voteToKill(players[0], mafia, killed);
          await as(players[0]).executePhase();

          // Sanity check
          const selfInfo = await this.getSelfInfo(players[0], killed);
          expect(selfInfo.dead).to.be.true;

          await this.accuse(players[0], civ, mafia[1]);
          await this.accuse(players[0], mafia, mafia[1]);
          await as(players[0]).executePhase();

          await expect(as(mafia[0]).voteToKill(players[0], killed)).to.be.revertedWith("dead players cannot be killed again");
        })

        it("disallows voting multiple times during a round", async () => {
          await as(mafia[0]).voteToKill(players[0], civ[0]);
          // even though it's a different person, it should be rejected
          await expect(as(mafia[0]).voteToKill(players[0], civ[1])).to.be.revertedWith("only one vote to kill each round can be submitted");
        })

        it("disallows voting to kill people who have been expelled", async () => {
          const expelled = civ[civ.length - 1];
          // sanity check
          const selfInfo = await this.getSelfInfo(players[0], expelled);
          expect(selfInfo.convicted).to.be.true;

          await expect(as(mafia[0]).voteToKill(players[0], expelled)).to.be.revertedWith("players convicted as Mafia cannot be killed");
        })
      })
    })
});
  