require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.18",
  networks: {
    'base-goerli': {
      url: 'https://goerli.base.org',
      accounts: [process.env.WALLET_KEY],
      gasPrice: 1000000000,
    },
  // uncomment the below to run this locally
  //   'hardhat': {
  //     accounts: process.env.WALLET_KEYS.split(",").map(key => {
  //       return {
  //         privateKey: key,
  //         balance: "100000000000000000000000000",
  //       }
  //     }),
  //   },
  },
  // defaultNetwork: 'hardhat',
};
