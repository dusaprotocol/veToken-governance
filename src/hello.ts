import {
  Account,
  Args,
  bytesToStr,
  SmartContract,
  U256,
  Web3Provider,
} from '@massalabs/massa-web3';
import 'dotenv/config';

const account = await Account.fromEnv();
const provider = Web3Provider.buildnet(account);

const ve = 'AS1MH6eJ4XGvw4Lsq7qS8UDjVzAgcHBSSTdc6z3odppM9Q134UzT';
const voter = 'AS1UxmVYxof8cKDhjjALpJTSY3ZWviV1NquZg4ovXU5ycrkpQogD';
const veContract = new SmartContract(provider, ve);

const tx = await veContract.call('setVoter', new Args().addString(voter));
console.log(`Transaction hash: ${tx.id}`);

// const messageBin = await veContract.read('totalSupply');
// const message = U256.fromBytes(messageBin.value);
// console.log(`Received from the contract: ${message}`);
