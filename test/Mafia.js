const { expect } = require("chai");
const { ethers } = require("hardhat");
  
  describe("Mafia", function () {
    before(async function () {
      this.Mafia = await ethers.getContractFactory('Mafia');
    });
  
    beforeEach(async function () {
      this.mafia = await this.Mafia.deploy();
    });
});
  