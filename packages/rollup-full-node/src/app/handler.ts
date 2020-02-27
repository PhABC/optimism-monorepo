/* External Imports */
import { Address } from '@eth-optimism/rollup-core'
import {
  add0x,
  getLogger,
  logError,
  remove0x,
  ZERO_ADDRESS,
} from '@eth-optimism/core-utils'
import {
  CHAIN_ID,
  GAS_LIMIT,
  convertInternalLogsToOvmLogs,
  L2ExecutionManagerContractDefinition,
  OPCODE_WHITELIST_MASK,
  internalTxReceiptToOvmTxReceipt,
} from '@eth-optimism/ovm'

import { Contract, ethers, utils, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'

import AsyncLock from 'async-lock'

/* Internal Imports */
import { DEFAULT_ETHNODE_GAS_LIMIT } from '.'
import {
  FullnodeHandler,
  InvalidParametersError,
  UnsupportedMethodError,
  Web3Handler,
  Web3RpcMethods,
} from '../types'

const log = getLogger('web3-handler')

const lockKey: string = 'LOCK'

const latestBlock: string = 'latest'

export class DefaultWeb3Handler implements Web3Handler, FullnodeHandler {
  private lock: AsyncLock

  /**
   * Creates a local node, deploys the L2ExecutionManager to it, and returns a
   * Web3Handler that handles Web3 requests to it.
   *
   * @param provider (optional) The web3 provider to use.
   * @returns The constructed Web3 handler.
   */
  public static async create(
    provider: Web3Provider = createMockProvider({
      gasLimit: DEFAULT_ETHNODE_GAS_LIMIT,
    })
  ): Promise<DefaultWeb3Handler> {
    // Initialize a fullnode for us to interact with
    const [wallet] = getWallets(provider)
    const executionManager: Contract = await DefaultWeb3Handler.deployExecutionManager(
      wallet,
      OPCODE_WHITELIST_MASK
    )

    return new DefaultWeb3Handler(provider, wallet, executionManager)
  }

  private constructor(
    private readonly provider: Web3Provider,
    private readonly wallet: Wallet,
    private readonly executionManager: Contract
  ) {
    this.lock = new AsyncLock()
  }

  /**
   * Handles generic Web3 requests.
   *
   * @param method The Web3 method being requested.
   * @param params The parameters for the method in question.
   *
   * @returns The response if the method is supported and properly formatted.
   * @throws If the method is not supported or request is improperly formatted.
   */
  public async handleRequest(method: string, params: any[]): Promise<string> {
    log.debug(
      `Handling request, method: [${method}], params: [${JSON.stringify(
        params
      )}]`
    )

    // Make sure the method is available
    let response: any
    let args: any[]
    switch (method) {
      case Web3RpcMethods.blockNumber:
        this.assertParameters(params, 0)
        response = await this.blockNumber()
        break
      case Web3RpcMethods.call:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.call(args[0], args[1])
        break
      case Web3RpcMethods.estimateGas:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.estimateGas(args[0], args[1])
        break
      case Web3RpcMethods.gasPrice:
        this.assertParameters(params, 0)
        response = await this.gasPrice()
        break
      case Web3RpcMethods.getBlockByNumber:
        args = this.assertParameters(params, 2)
        response = await this.getBlockByNumber(args[0], args[1])
        break
      case Web3RpcMethods.getCode:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.getCode(args[0], args[1])
        break
      case Web3RpcMethods.getExecutionManagerAddress:
        this.assertParameters(params, 0)
        response = await this.getExecutionManagerAddress()
        break
      case Web3RpcMethods.getLogs:
        args = this.assertParameters(params, 1)
        response = await this.getLogs([0])
        break
      case Web3RpcMethods.getTransactionCount:
        args = this.assertParameters(params, 2, latestBlock)
        response = await this.getTransactionCount(args[0], args[1])
        break
      case Web3RpcMethods.getTransactionReceipt:
        args = this.assertParameters(params, 1)
        response = await this.getTransactionReceipt(args[0])
        break
      case Web3RpcMethods.sendRawTransaction:
        args = this.assertParameters(params, 1)
        response = await this.sendRawTransaction(args[0])
        break
      case Web3RpcMethods.networkVersion:
        this.assertParameters(params, 0)
        response = await this.networkVersion()
        break
      case Web3RpcMethods.evmSnapshot:
        this.assertParameters(params, 0)
        response = await this.provider.send(Web3RpcMethods.evmSnapshot, [])
        break
      case Web3RpcMethods.evmRevert:
        args = this.assertParameters(params, 1)
        response = await this.provider.send(Web3RpcMethods.evmRevert, params)
        break
      case Web3RpcMethods.evmMine:
        response = await this.provider.send(Web3RpcMethods.evmMine, params)
        break
      default:
        const msg: string = `Method / params [${method} / ${JSON.stringify(
          params
        )}] is not supported by this Web3 handler!`
        log.error(msg)
        throw new UnsupportedMethodError(msg)
    }

    log.debug(
      `Request: method [${method}], params: [${JSON.stringify(
        params
      )}], got result: [${JSON.stringify(response)}]`
    )
    return response
  }

  public async blockNumber(): Promise<string> {
    log.debug(`Requesting block number.`)
    const response = await this.provider.send(Web3RpcMethods.blockNumber, [])
    // For now we will just use the internal node's blocknumber.
    // TODO: Add rollup block tracking
    log.debug(`Received block number [${response}].`)
    return response
  }

  public async call(txObject: {}, defaultBlock: string): Promise<string> {
    log.debug(
      `Making eth_call: [${JSON.stringify(
        txObject
      )}], defaultBlock: [${defaultBlock}]`
    )
    // First generate the internalTx calldata
    const internalCalldata = this.generateUnsignedCallCalldata(
      0,
      0,
      txObject['to'],
      txObject['data'],
      txObject['from']
    )

    let response
    try {
      // Then actually make the call and get the response
      response = await this.provider.send(Web3RpcMethods.call, [
        {
          from: ZERO_ADDRESS,
          to: this.executionManager.address,
          data: internalCalldata,
        },
        defaultBlock,
      ])
    } catch (e) {
      log.debug(
        `Error executing call: ${JSON.stringify(
          txObject
        )}, default block: ${defaultBlock}, error: ${JSON.stringify(e)}`
      )
      throw e
    }

    // Now just return the response!
    log.debug(
      `eth_call with request: [${JSON.stringify(
        txObject
      )}] default block: ${defaultBlock} got response [${response}]`
    )
    return response
  }

  public async estimateGas(
    txObject: {},
    defaultBlock: string
  ): Promise<string> {
    log.debug(
      `Estimating gas: [${JSON.stringify(
        txObject
      )}], defaultBlock: [${defaultBlock}]`
    )
    // First generate the internalTx calldata
    const internalCalldata = this.generateUnsignedCallCalldata(
      0,
      0,
      txObject['to'],
      txObject['data'],
      txObject['from']
    )

    log.debug(internalCalldata)
    // Then estimate the gas
    const response = await this.provider.send(Web3RpcMethods.estimateGas, [
      {
        from: ZERO_ADDRESS,
        to: this.executionManager.address,
        data: internalCalldata,
      },
    ])
    // TODO: Make sure gas limit is below max
    log.debug(
      `Estimated gas: request: [${JSON.stringify(
        txObject
      )}] default block: ${defaultBlock} got response [${response}]`
    )
    return add0x(GAS_LIMIT.toString(16))
  }

  public async gasPrice(): Promise<string> {
    // Gas price is always zero
    return '0x0'
  }

  public async getBlockByNumber(
    defaultBlock: string,
    fullObjects: boolean
  ): Promise<any> {
    log.debug(`Got request to get block ${defaultBlock}.`)
    const res: string = await this.provider.send(
      Web3RpcMethods.getBlockByNumber,
      [defaultBlock, fullObjects]
    )
    log.debug(
      `Returning block ${defaultBlock} (fullObj: ${fullObjects}): ${JSON.stringify(
        res
      )}`
    )
    return res
  }

  public async getCode(
    address: Address,
    defaultBlock: string
  ): Promise<string> {
    if (defaultBlock !== 'latest') {
      // throw new Error('No support for historical code lookups!')
      log.warn('No support for historical code lookups!')
    }
    log.debug(
      `Getting code for address: [${address}], defaultBlock: [${defaultBlock}]`
    )
    // First get the code contract address at the requested OVM address
    const codeContractAddress = await this.executionManager.getCodeContractAddress(
      address
    )
    const response = await this.provider.send(Web3RpcMethods.getCode, [
      codeContractAddress,
      'latest',
    ])
    log.debug(
      `Got code for address [${address}], block [${defaultBlock}]: [${response}]`
    )
    return response
  }

  public async getExecutionManagerAddress(): Promise<Address> {
    return this.executionManager.address
  }

  public async getLogs(filter: any): Promise<any[]> {
    log.debug(`Requesting logs with filter [${JSON.stringify(filter)}].`)
    const res = await this.provider.send(Web3RpcMethods.getLogs, filter)
    log.debug(`Log result: [${res}], filter: [${JSON.stringify(filter)}].`)
    return res
  }

  public async getTransactionCount(
    address: Address,
    defaultBlock: string
  ): Promise<string> {
    log.debug(
      `Requesting transaction count. Address [${address}], block: [${defaultBlock}].`
    )
    const response = add0x(
      (await this.executionManager.getOvmContractNonce(address)).toString(16)
    )
    log.debug(
      `Received transaction count for Address [${address}], block: [${defaultBlock}]: [${response}].`
    )
    return response
  }

  public async getTransactionReceipt(ovmTxHash: string): Promise<any> {
    log.debug('Getting tx receipt for ovm tx hash:', ovmTxHash)
    // First convert our ovmTxHash into an internalTxHash
    const internalTxHash = await this.getInternalTxHash(ovmTxHash)

    const internalTxReceipt = await this.provider.send(
      Web3RpcMethods.getTransactionReceipt,
      [internalTxHash]
    )

    // Now let's parse the internal transaction reciept
    const ovmTxReceipt = await internalTxReceiptToOvmTxReceipt(
      internalTxReceipt
    )
    log.debug(
      `Returning tx receipt for ovm tx hash [${ovmTxHash}]: [${internalTxReceipt}]`
    )
    return ovmTxReceipt
  }

  public async networkVersion(): Promise<string> {
    log.debug('Getting network version')
    // Return our internal chain_id
    // TODO: Add getter for chainId that is not just imported
    const response = CHAIN_ID
    log.debug(`Got network version: [${response}]`)
    return response.toString()
  }

  public async sendRawTransaction(rawOvmTx: string): Promise<string> {
    // lock here because the mapOmTxHash... tx and the sendRawTransaction tx need to be in order because of nonces.
    return this.lock.acquire(lockKey, async () => {
      log.debug('Sending raw transaction with params:', rawOvmTx)

      // Decode the OVM transaction -- this will be used to construct our internal transaction
      const ovmTx = utils.parseTransaction(rawOvmTx)
      log.debug(
        `OVM Transaction being parsed ${rawOvmTx}, parsed: ${JSON.stringify(
          ovmTx
        )}`
      )

      // Convert the OVM transaction into an "internal" tx which we can use for our execution manager
      const internalTx = await this.ovmTxToInternalTx(ovmTx)
      // Now compute the hash of the OVM transaction which we will return
      const ovmTxHash = await utils.keccak256(rawOvmTx)
      const internalTxHash = await utils.keccak256(internalTx)

      // Make sure we have a way to look up our internal tx hash from the ovm tx hash.
      await this.mapOvmTxHashToInternalTxHash(ovmTxHash, internalTxHash)

      let returnedInternalTxHash: string
      try {
        // Then apply our transaction
        returnedInternalTxHash = await this.provider.send(
          Web3RpcMethods.sendRawTransaction,
          internalTx
        )
      } catch (e) {
        logError(
          log,
          `Error executing transaction. Incrementing nonce for sender (${ovmTx.from} and returning failed tx hash. Ovm tx hash: ${ovmTxHash}, internal hash: ${internalTxHash}.`,
          e
        )

        await this.executionManager.incrementNonce(add0x(ovmTx.from))
        log.debug(`Nonce incremented successfully for ${ovmTx.from}.`)

        return ovmTxHash
      }

      if (remove0x(internalTxHash) !== remove0x(returnedInternalTxHash)) {
        const msg: string = `Internal Transaction hashes do not match for OVM Hash: [${ovmTxHash}]. Calculated: [${internalTxHash}], returned from tx: [${returnedInternalTxHash}]`
        log.error(msg)
        throw Error(msg)
      }

      log.debug(`Completed send raw tx [${rawOvmTx}]. Response: [${ovmTxHash}]`)
      // Return the *OVM* tx hash. We can do this because we store a mapping to the ovmTxHashs in the EM contract.
      return ovmTxHash
    })
  }

  /**
   * Maps the provided OVM transaction hash to the provided internal transaction hash by storing it in our
   * L2 Execution Manager contract.
   *
   * @param ovmTxHash The OVM transaction's hash.
   * @param internalTxHash Our internal transactions's hash.
   * @throws if not stored properly
   */
  private async mapOvmTxHashToInternalTxHash(
    ovmTxHash: string,
    internalTxHash: string
  ): Promise<void> {
    return this.executionManager.mapOvmTransactionHashToInternalTransactionHash(
      add0x(ovmTxHash),
      add0x(internalTxHash)
    )
  }

  private async getInternalTxHash(ovmTxHash: string): Promise<string> {
    return this.executionManager.getInternalTransactionHash(add0x(ovmTxHash))
  }

  /**
   * OVM tx to EVM tx converter
   */
  private async ovmTxToInternalTx(ovmTx: any): Promise<string> {
    // Verify that the transaction is not accidentally sending to the ZERO_ADDRESS
    if (ovmTx.to === ZERO_ADDRESS) {
      throw new Error('Sending to Zero Address disallowed')
    }
    // Get the nonce of the account that we will use to send everything
    // Note: + 1 because all transactions will have a tx hash mapping tx sent before them.
    // Check that this is an EOA transaction, if not we throw until we've
    // implemented non-EOA transactions
    if (ovmTx.v === 0) {
      log.error(
        'Transaction does not have a valid signature! For now we only support calls from EOAs'
      )
      throw new Error('Non-EOA transaction detected')
    }
    // TODO: Make sure we lock this function with this nonce so we don't send to txs with the same nonce
    const nonce = (await this.wallet.getTransactionCount()) + 1
    // Generate the calldata which we'll use to call our internal execution manager
    // First pull out the `to` field (we just need to check if it's null & if so set ovmTo to the zero address as that's how we deploy contracts)
    const ovmTo = ovmTx.to === null ? ZERO_ADDRESS : ovmTx.to
    // Construct the raw transaction calldata
    const internalCalldata = this.generateEOACallCalldata(
      0,
      0,
      ovmTx.nonce,
      ovmTo,
      ovmTx.data,
      ovmTx.v,
      ovmTx.r,
      ovmTx.s
    )

    log.debug(`EOA calldata: [${internalCalldata}]`)

    const internalTx = {
      nonce,
      gasLimit: ovmTx.gasLimit,
      gasPrice: 0,
      to: this.executionManager.address,
      value: 0,
      data: internalCalldata,
      chainId: 108,
    }
    log.debug('The internal tx:', internalTx)
    return this.wallet.sign(internalTx)
  }

  private static async deployExecutionManager(
    wallet: Wallet,
    opcodeWhitelistMask: string
  ): Promise<Contract> {
    // Now deploy the execution manager!
    const executionManager: Contract = await deployContract(
      wallet,
      L2ExecutionManagerContractDefinition,
      [opcodeWhitelistMask, wallet.address, GAS_LIMIT, true],
      { gasLimit: DEFAULT_ETHNODE_GAS_LIMIT }
    )

    log.info('Deployed execution manager to address:', executionManager.address)

    return executionManager
  }

  private generateUnsignedCallCalldata(
    timestamp: number,
    queueOrigin: number,
    ovmEntrypoint: string,
    callBytes: string,
    fromAddress: string
  ): string {
    // Update the ovmEntrypoint to be the ZERO_ADDRESS if this is a contract creation
    if (ovmEntrypoint === null || ovmEntrypoint === undefined) {
      ovmEntrypoint = ZERO_ADDRESS
    }
    return this.executionManager.interface.functions[
      'executeUnsignedEOACall'
    ].encode([timestamp, queueOrigin, ovmEntrypoint, callBytes, fromAddress])
  }

  private generateEOACallCalldata(
    timestamp: number,
    queueOrigin: number,
    nonce: number,
    ovmEntrypoint: string,
    callBytes: string,
    v: number,
    r: string,
    s: string
  ): string {
    // Update the ovmEntrypoint to be the ZERO_ADDRESS if this is a contract creation
    if (ovmEntrypoint === null || ovmEntrypoint === undefined) {
      ovmEntrypoint = ZERO_ADDRESS
    }

    log.debug(
      `Generating EOA Calldata: v: [${v}], r: [${r}], s: [${s}], nonce: [${nonce}] entrypoint: [${ovmEntrypoint}], callBytes: [${callBytes}]`
    )

    return this.executionManager.interface.functions['executeEOACall'].encode([
      timestamp,
      queueOrigin,
      nonce,
      ovmEntrypoint,
      callBytes,
      v,
      r,
      s,
    ])
  }

  private assertParameters(
    params: any[],
    expected: number,
    defaultLast?: any
  ): any[] {
    if (!params) {
      if (!expected) {
        return []
      }
    } else if (params.length === expected - 1 || params.length === expected) {
      return params.length === expected ? params : [...params, defaultLast]
    }
    throw new InvalidParametersError(
      `Expected ${expected} parameters but received ${
        !params ? 0 : params.length
      }.`
    )
  }
}
