/// A single detected fill from a followed trader's wallet, normalized from
/// whatever the DreamDEX WS feed sent (see detector.ts's header comment for
/// why the raw-message field names are unverified).
export interface TradeEvent {
  traderAddress: `0x${string}`;
  /// Whatever detector.ts pulled out as the market identifier — may be a
  /// pool contract address or a symbol like "WETHUSDso"; executor.ts
  /// resolves either. See detector.ts and executor.ts header comments.
  marketId: string;
  isBid: boolean;
  /// Raw on-chain units — must match what CopyVault.executeCopy /
  /// IDreamDEXPool.placeOrder expect for `price` (see contracts/src).
  price: bigint;
  /// Raw on-chain units — must match `quantity` in the same call.
  quantity: bigint;
  /// The original parsed WS message, kept for logging/debugging.
  raw: unknown;
}
