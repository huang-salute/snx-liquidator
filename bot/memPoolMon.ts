import BlocknativeSdk from 'bnc-sdk';
import { EthereumTransactionData } from 'bnc-sdk/dist/types/src/interfaces';
import WebSocket from 'ws';
import {
  FlashbotsBundleProvider,
  FlashbotsTransactionResponse,
} from '@flashbots/ethers-provider-bundle';
import { encode } from 'rlp';
import web3 from 'web3';

import { sethLoaners, susdLoaners } from './loaners';
import {
  provider,
  authSigner,
  getBundles,
  susdCollateralAddr,
  sethCollateralAddr,
} from './flashbotBase';
import { ethers } from 'ethers';

const snxDAO = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';

const options = {
  dappId: '85c6c02a-2df3-4758-980a-7143da2ae777',
  networkId: 1,
  ws: WebSocket,
  name: 'Snx DAO monitor',
  onerror: (error: any) => {
    console.log(error);
  },
};

// initialize and connect to the api
const blocknative = new BlocknativeSdk(options);
blocknative.configuration({ scope: snxDAO, watchAddress: true });

function constructSignedTx(tx: EthereumTransactionData): string {
  const params = [
    web3.utils.numberToHex(tx.nonce),
    web3.utils.numberToHex(parseInt(tx.gasPrice)),
    web3.utils.numberToHex(tx.gas),
    tx.to,
    tx.value === '0' ? '0x' : web3.utils.numberToHex(parseInt(tx.value)),
    tx.input,
    tx.v,
    tx.r,
    tx.s,
  ];
  return '0x' + encode(params).toString('hex');
}

function trySubmitBundlesWithSnxTx(
  flashbotsProvider: FlashbotsBundleProvider,
  bundle: Array<string>,
  revertingTxHashes: Array<string>,
  snxTx: string,
  blockNumber: number
) {
  // Insert snx tx to the begining
  bundle.unshift(snxTx);

  // try 3 blocks
  for (let i = blockNumber + 1; i <= blockNumber + 3; i++) {
    console.log(`Try submit bundle on block ${i}`);

    flashbotsProvider
      .sendRawBundle(bundle, i, { revertingTxHashes })
      .then((bundleSubmission) => {
        console.log(`bundle submitted, waiting`);
        if ('error' in bundleSubmission) {
          throw new Error(bundleSubmission.error.message);
        }
        return (bundleSubmission as FlashbotsTransactionResponse).wait();
      })
      .then((waitResponse) => {
        console.log(`Response: ${waitResponse}`);
        if (waitResponse === 0) {
          console.log('Bundle handled successfully');
          process.exit(0);
        } else {
        }
      })
      .catch((e) => {
        console.error('Bundle error: ', e);
      });
  }
}

async function main() {
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner
  );

  const [susdSignedTxs, susdRevertingTxHashes] = await getBundles(
    susdLoaners,
    flashbotsProvider
  );
  const [sethSignedTxs, sethRevertingTxHashes] = await getBundles(
    sethLoaners,
    flashbotsProvider
  );

  let blockNumber = await provider.getBlockNumber();
  provider.on('block', async (_blockNumber) => {
    console.log(`Block number: ${_blockNumber}`);
    blockNumber = _blockNumber;
  });

  const { emitter } = blocknative.account(snxDAO);

  let counter = 1;
  emitter.on('txPool', (tx) => {
    tx = tx as EthereumTransactionData;
    console.log('Tx hash:', tx.hash);
    const signedSnxTx = constructSignedTx(tx);

    // trySubmitBundlesWithSnxTx(
    //   flashbotsProvider,
    //   susdSignedTxs,
    //   susdRevertingTxHashes,
    //   signedSnxTx,
    //   blockNumber
    // );

    counter += 1;
    if (counter === 2) {
      trySubmitBundlesWithSnxTx(
        flashbotsProvider,
        sethSignedTxs,
        sethRevertingTxHashes,
        signedSnxTx,
        blockNumber
      );
    }
  });

  // emitter.on('txPoolSimulation', (tx) => {
  //   tx = tx as EthereumTransactionData;
  //   console.log('Tx hash:', tx.hash);
  //   const signedSnxTx = constructSignedTx(tx);
  //   for (const interCall of (tx as any).internalTransactions) {
  //     let bundle: Array<string>, revertingHashes: Array<string>;

  //     switch (interCall.to.toLowerCase()) {
  //       case susdCollateralAddr.toLowerCase():
  //         bundle = susdSignedTxs;
  //         revertingHashes = susdRevertingTxHashes;
  //         break;
  //       case sethCollateralAddr.toLowerCase():
  //         bundle = sethSignedTxs;
  //         revertingHashes = sethRevertingTxHashes;
  //         break;
  //       default:
  //         continue;
  //     }

  //     trySubmitBundlesWithSnxTx(
  //       flashbotsProvider,
  //       bundle,
  //       revertingHashes,
  //       signedSnxTx,
  //       blockNumber
  //     );
  //   }
  // });
}

main()
  .then()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });