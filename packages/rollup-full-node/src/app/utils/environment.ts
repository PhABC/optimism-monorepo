import {
  DEFAULT_OPCODE_WHITELIST_MASK,
  L2_TO_L1_MESSAGE_PASSER_OVM_ADDRESS,
} from '@eth-optimism/ovm'

/**
 * Class to contain all environment variables referenced by the rollup full node
 * to consolidate access / updates and default values.
 */
export class Environment {
  public static clearDataKey(defaultValue?: string) {
    return process.env.CLEAR_DATA_KEY || defaultValue
  }

  // L2 Rpc Server Config
  public static l2RpcServerPersistentDbPath(defaultValue?: string) {
    return process.env.L2_RPC_SERVER_PERSISTENT_DB_PATH || defaultValue
  }
  public static l2RpcServerHost(defaultValue: string = '0.0.0.0'): string {
    return process.env.L2_RPC_SERVER_HOST || defaultValue
  }
  public static l2RpcServerPort(defaultValue: number = 8545): number {
    return process.env.L2_RPC_SERVER_PORT
      ? parseInt(process.env.L2_RPC_SERVER_PORT, 10)
      : defaultValue
  }

  // Local Node Config
  public static opcodeWhitelistMask(
    defaultValue: string = DEFAULT_OPCODE_WHITELIST_MASK
  ): string {
    return process.env.OPCODE_WHITELIST_MASK || defaultValue
  }
  public static localL2NodePersistentDbPath(defaultValue?: string) {
    return process.env.LOCAL_L2_NODE_PERSISTENT_DB_PATH || defaultValue
  }
  public static localL1NodePersistentDbPath(defaultValue?: string): string {
    return process.env.LOCAL_L1_NODE_PERSISTENT_DB_PATH || defaultValue
  }

  // L2 Config
  public static l2NodeWeb3Url(defaultValue?: string): string {
    return process.env.L2_NODE_WEB3_URL || defaultValue
  }
  public static l2WalletPrivateKey(defaultValue?: string): string {
    return process.env.L2_WALLET_PRIVATE_KEY || defaultValue
  }
  public static l2WalletMnemonic(defaultValue?: string): string {
    return process.env.L2_WALLET_MNEMONIC || defaultValue
  }
  public static l2WalletPrivateKeyPath(defaultValue?: string): string {
    return process.env.L2_WALLET_PRIVATE_KEY_PATH || defaultValue
  }
  public static l2ExecutionManagerAddress(defaultValue?: string): string {
    return process.env.L2_EXECUTION_MANAGER_ADDRESS || defaultValue
  }
  public static l2ToL1MessagePasserOvmAddress(
    defaultValue = L2_TO_L1_MESSAGE_PASSER_OVM_ADDRESS
  ): string {
    return process.env.L2_TO_L1_MESSAGE_PASSER_OVM_ADDRESS || defaultValue
  }

  // L1 Config
  public static l1NodeWeb3Url(defaultValue?: string): string {
    return process.env.L1_NODE_WEB3_URL || defaultValue
  }
  public static localL1NodePort(defaultValue: number = 7545): number {
    return process.env.LOCAL_L1_NODE_PORT
      ? parseInt(process.env.LOCAL_L1_NODE_PORT, 10)
      : defaultValue
  }
  // TODO: remove default when this matters
  public static sequencerMnemonic(
    defaultValue: string = 'rebel talent argue catalog maple duty file taxi dust hire funny steak'
  ): string {
    return process.env.L1_SEQUENCER_MNEMONIC || defaultValue
  }
  public static sequencerPrivateKey(defaultValue?: string): string {
    return process.env.L1_SEQUENCER_PRIVATE_KEY || defaultValue
  }
  public static l1ToL2TransactionPasserAddress(defaultValue?: string): string {
    return process.env.L1_TO_L2_TRANSACTION_PASSER_ADDRESS || defaultValue
  }
  public static l2ToL1MessageReceiverAddress(defaultValue?: string): string {
    return process.env.L2_TO_L1_MESSAGE_RECEIVER_ADDRESS || defaultValue
  }
  public static l2ToL1MessageFinalityDelayInBlocks(
    defaultValue: number = 0
  ): number {
    return process.env.L2_TO_L1_MESSAGE_FINALITY_DELAY_IN_BLOCKS
      ? parseInt(process.env.L2_TO_L1_MESSAGE_FINALITY_DELAY_IN_BLOCKS, 10)
      : defaultValue
  }
}
