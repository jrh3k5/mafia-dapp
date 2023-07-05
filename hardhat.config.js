require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.18",
  networks: {
    'hardhat': {
      accounts: [
        {
          privateKey: process.env.WALLET_KEY,
          balance: "100000000000000000000000000",
        }
      ],
    },
  },
  defaultNetwork: 'hardhat',
};
