import '../setup'
/* External Imports */
import { getLogger } from '@eth-optimism/core-utils'
import { ethers, ContractFactory, Wallet, Contract } from 'ethers'
import { resolve } from 'path'
import * as rimraf from 'rimraf'
import * as fs from 'fs'

/* Internal Imports */
import {
  FullnodeRpcServer,
  DefaultWeb3Handler,
  TestWeb3Handler,
} from '../../src/app'
import * as SimpleStorage from '../contracts/build/untranspiled/SimpleStorage.json'

const log = getLogger('web3-handler', true)

const host = '0.0.0.0'
const port = 9999

// Create some constants we will use for storage
const storageKey = '0x' + '01'.repeat(32)
const storageValue = '0x' + '02'.repeat(32)

const tmpFilePath = resolve(__dirname, `./.test_db`)

const getWallet = (httpProvider) => {
  const privateKey = '0x' + '60'.repeat(32)
  const wallet = new ethers.Wallet(privateKey, httpProvider)
  log.debug('Wallet address:', wallet.address)
  return wallet
}

const deploySimpleStorage = async (wallet: Wallet): Promise<Contract> => {
  const factory = new ContractFactory(
    SimpleStorage.abi,
    SimpleStorage.bytecode,
    wallet
  )

  // Deploy tx normally
  const simpleStorage = await factory.deploy()
  // Get the deployment tx receipt
  const deploymentTxReceipt = await wallet.provider.getTransactionReceipt(
    simpleStorage.deployTransaction.hash
  )
  // Verify that the contract which was deployed is correct
  deploymentTxReceipt.contractAddress.should.equal(simpleStorage.address)

  return simpleStorage
}

const setAndGetStorage = async (
  simpleStorage: Contract,
  httpProvider,
  executionManagerAddress
): Promise<void> => {
  await setStorage(simpleStorage, httpProvider, executionManagerAddress)
  await getAndVerifyStorage(
    simpleStorage,
    httpProvider,
    executionManagerAddress
  )
}

const setStorage = async (
  simpleStorage: Contract,
  httpProvider,
  executionManagerAddress
): Promise<void> => {
  // Set storage with our new storage elements
  const tx = await simpleStorage.setStorage(
    executionManagerAddress,
    storageKey,
    storageValue
  )
  await httpProvider.getTransactionReceipt(tx.hash)
}

const getAndVerifyStorage = async (
  simpleStorage: Contract,
  httpProvider,
  executionManagerAddress
): Promise<void> => {
  // Get the storage
  const res = await simpleStorage.getStorage(
    executionManagerAddress,
    storageKey
  )
  // Verify we got the value!
  res.should.equal(storageValue)
}

/**
 * Creates an unsigned transaction.
 * @param {ethers.Contract} contract
 * @param {String} functionName
 * @param {Array} args
 */
export const getUnsignedTransactionCalldata = (
  contract,
  functionName,
  args
) => {
  return contract.interface.functions[functionName].encode(args)
}

/*********
 * TESTS *
 *********/

describe('Web3Handler', () => {
  let web3Handler: DefaultWeb3Handler
  let fullnodeRpcServer: FullnodeRpcServer
  let httpProvider

  beforeEach(async () => {
    web3Handler = await DefaultWeb3Handler.create()
    fullnodeRpcServer = new FullnodeRpcServer(web3Handler, host, port)

    fullnodeRpcServer.listen()

    httpProvider = new ethers.providers.JsonRpcProvider(
      `http://${host}:${port}`
    )
  })

  afterEach(() => {
    if (!!fullnodeRpcServer) {
      fullnodeRpcServer.close()
    }
  })

  describe('ephemeral node', () => {
    describe('the getBlockByNumber endpoint', () => {
      it('should return a block with the correct timestamp', async () => {
        const block = await httpProvider.getBlock('latest')

        block.timestamp.should.be.gt(0)
      })

      it('should strip the execution manager deployment transaction from the transactions object', async () => {
        const block = await httpProvider.getBlock(1, true)

        block['transactions'].should.be.empty
      })

      it('should increase the timestamp when blocks are created', async () => {
        const executionManagerAddress = await httpProvider.send(
          'ovm_getExecutionManagerAddress',
          []
        )
        const { timestamp } = await httpProvider.getBlock('latest')
        const wallet = getWallet(httpProvider)
        const simpleStorage = await deploySimpleStorage(wallet)
        await setAndGetStorage(
          simpleStorage,
          httpProvider,
          executionManagerAddress
        )

        const block = await httpProvider.getBlock('latest', true)
        block.timestamp.should.be.gte(timestamp)
      })
    })

    describe('the getBlockByHash endpoint', () => {
      it('should return the same block that is returned by eth_getBlockByNumber', async () => {
        const blockRetrievedByNumber = await httpProvider.getBlock('latest')
        const blockRetrievedByHash = await httpProvider.getBlock(
          blockRetrievedByNumber.hash
        )

        blockRetrievedByHash.should.deep.equal(blockRetrievedByNumber)
      })

      it('should return the same black as eth_getBlockByNumber even after another block is created', async () => {
        const executionManagerAddress = await httpProvider.send(
          'ovm_getExecutionManagerAddress',
          []
        )
        const wallet = getWallet(httpProvider)
        const simpleStorage = await deploySimpleStorage(wallet)
        await setAndGetStorage(
          simpleStorage,
          httpProvider,
          executionManagerAddress
        )

        const blockRetrievedByNumber = await httpProvider.getBlock(
          'latest',
          true
        )
        const blockRetrievedByHash = await httpProvider.getBlock(
          blockRetrievedByNumber.hash,
          true
        )

        blockRetrievedByHash.should.deep.equal(blockRetrievedByNumber)
      })
    })

    describe('SimpleStorage integration test', () => {
      it('should set storage & retrieve the value', async () => {
        const executionManagerAddress = await httpProvider.send(
          'ovm_getExecutionManagerAddress',
          []
        )

        const wallet = getWallet(httpProvider)
        const simpleStorage = await deploySimpleStorage(wallet)

        await setAndGetStorage(
          simpleStorage,
          httpProvider,
          executionManagerAddress
        )
      })
    })

    describe('snapshot and revert', () => {
      it('should  fail (snapshot and revert should only be available in the TestHandler)', async () => {
        await new Promise((resolveFunc, reject) => {
          httpProvider.send('evm_snapshot', []).catch((error) => {
            error.message.should.equal('Method not found')
            resolveFunc()
          })
        })

        await new Promise((resolveFunc, reject) => {
          httpProvider.send('evm_snapshot', []).catch((error) => {
            error.message.should.equal('Method not found')
            resolveFunc()
          })
        })

        await new Promise((resolveFunc, reject) => {
          httpProvider.send('evm_revert', ['0x01']).catch((error) => {
            error.message.should.equal('Method not found')
            resolveFunc()
          })
        })
      })
    })

    describe('L1 to L2 Transaction Passing', () => {
      let executionManagerAddress
      let simpleStorage: Contract
      let wallet: Wallet
      beforeEach(async () => {
        executionManagerAddress = await httpProvider.send(
          'ovm_getExecutionManagerAddress',
          []
        )

        wallet = getWallet(httpProvider)
        simpleStorage = await deploySimpleStorage(wallet)
      })

      it('should process L1 to L2 Transaction', async () => {
        const callData = getUnsignedTransactionCalldata(
          simpleStorage,
          'setStorage',
          [executionManagerAddress, storageKey, storageValue]
        )
        await web3Handler.handleL1ToL2Transaction({
          nonce: 0,
          callData,
          sender: wallet.address,
          target: simpleStorage.address,
        })

        await getAndVerifyStorage(
          simpleStorage,
          httpProvider,
          executionManagerAddress
        )
      })

      it('should not throw if L1 to L2 Transaction reverts', async () => {
        const callData = getUnsignedTransactionCalldata(
          simpleStorage,
          'justRevert',
          []
        )
        await web3Handler.handleL1ToL2Transaction({
          nonce: 0,
          callData,
          sender: wallet.address,
          target: simpleStorage.address,
        })
      })
    })
  })

  describe('persisted node', () => {
    let emAddress: string
    let wallet: Wallet
    let simpleStorage: Contract

    before(() => {
      rimraf.sync(tmpFilePath)
      fs.mkdirSync(tmpFilePath)
      process.env.LOCAL_L2_NODE_PERSISTENT_DB_PATH = tmpFilePath
    })
    after(() => {
      rimraf.sync(tmpFilePath)
      delete process.env.LOCAL_L2_NODE_PERSISTENT_DB_PATH
    })

    it('1/2 deploys the contracts', async () => {
      emAddress = await httpProvider.send('ovm_getExecutionManagerAddress', [])
      wallet = getWallet(httpProvider)

      simpleStorage = await deploySimpleStorage(wallet)
    })

    it('2/2 uses previously deployed contract', async () => {
      await setAndGetStorage(simpleStorage, httpProvider, emAddress)
    })
  })
})
