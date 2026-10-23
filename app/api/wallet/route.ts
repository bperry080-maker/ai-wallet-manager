import { NextRequest, NextResponse } from 'next/server';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;

async function rpc(method: string, params: unknown[]) {
  const endpoint = process.env.ETHEREUM_RPC_URL;
  if (!endpoint) {
    throw new Error('Server is missing ETHEREUM_RPC_URL. Configure your QuickNode Ethereum Mainnet endpoint in server environment variables.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`RPC request failed with HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC request failed');
  return data.result as unknown;
}

export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get('address');
    const tx = request.nextUrl.searchParams.get('tx');
    if (address && tx) return NextResponse.json({ error: 'Provide either address or tx, not both.' }, { status: 400 });

    if (address) {
      if (!ADDRESS_RE.test(address)) return NextResponse.json({ error: 'Invalid Ethereum address.' }, { status: 400 });
      const [balanceWei, blockHex, chainId] = await Promise.all([
        rpc('eth_getBalance', [address, 'latest']),
        rpc('eth_blockNumber', []),
        rpc('eth_chainId', []),
      ]);
      if (chainId !== '0x1') return NextResponse.json({ error: 'Configured RPC is not Ethereum Mainnet (chain ID 1).' }, { status: 502 });
      return NextResponse.json({
        network: 'Ethereum Mainnet',
        chainId: 1,
        address,
        balanceWei,
        blockNumber: Number(BigInt(String(blockHex || '0x0'))),
        source: 'Server-configured QuickNode RPC',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (tx) {
      if (!TX_RE.test(tx)) return NextResponse.json({ error: 'Invalid transaction hash.' }, { status: 400 });
      const [receipt, chainId] = await Promise.all([
        rpc('eth_getTransactionReceipt', [tx]),
        rpc('eth_chainId', []),
      ]);
      if (chainId !== '0x1') return NextResponse.json({ error: 'Configured RPC is not Ethereum Mainnet.' }, { status: 502 });
      if (!receipt) return NextResponse.json({ status: null, confirmed: false }, { headers: { 'Cache-Control': 'no-store' } });
      const parsed = receipt as { status?: string; blockNumber?: string };
      return NextResponse.json({
        status: parsed.status,
        confirmed: true,
        blockNumber: parsed.blockNumber ? Number(BigInt(parsed.blockNumber)) : null,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'Provide an address or transaction hash.' }, { status: 400 });
  } catch (error) {
    console.error('Wallet RPC request failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Wallet RPC request failed.' }, { status: 502 });
  }
}
