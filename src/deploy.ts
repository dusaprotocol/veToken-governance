/* eslint-disable no-console */
import {
  Account,
  Args,
  Mas,
  SmartContract,
  Web3Provider,
} from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const account = await Account.fromEnv();
console.log(account.address.toString());
const provider = Web3Provider.buildnet(account);
console.log('Deploying contract...');

// const byteCode = getScByteCode('build', 'main.wasm');
// const contract = await SmartContract.deploy(provider, byteCode, new Args(), {
//   coins: Mas.fromString('50'),
// });
// console.log('Contract deployed at:', contract.address);

// const events = await provider.getEvents({
//   smartContractAddress: contract.address,
// });
// for (const event of events) {
//   console.log('Event message:', event.data);
// }

// const tokenByteCode = getScByteCode('build', 'DUSA.wasm');
// const tokenContract = await SmartContract.deploy(
//   provider,
//   tokenByteCode,
//   new Args(),
//   { coins: Mas.fromString('5') },
// );
// console.log('Token deployed at:', tokenContract.address);
// const tokenAddress = tokenContract.address;
const tokenAddress = 'AS12WBfwEXfV5WQ41cBcwL6EzDZgWt7QdaBQ6ENoshXigKLJrJ7WS';

const veByteCode = getScByteCode('build', 'veDUSA.wasm');
const veContract = await SmartContract.deploy(
  provider,
  veByteCode,
  new Args().addString(tokenAddress),
  { coins: Mas.fromString('5') },
);
console.log('veDUSA deployed at:', veContract.address);
const veAddress = veContract.address;
// const veAddress = 'AS12srBZgYYwPyb9CYbDs9XAmTG4TBzmMaDw8mkAmrETEj8ZeV5pV';

const voterByteCode = getScByteCode('build', 'Voter.wasm');
const voterContract = await SmartContract.deploy(
  provider,
  voterByteCode,
  new Args().addString(veAddress),
  { coins: Mas.fromString('25') },
);
console.log('Voter deployed at:', voterContract.address);
