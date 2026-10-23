'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Wallet, QrCode, Send, ArrowDownToLine, ShieldCheck } from 'lucide-react';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window { ethereum?: EthereumProvider; }
}

const MAINNET_CHAIN_ID = '0x1';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;

function formatEth(wei: bigint, digits = 6) {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, digits);
  return `${whole.toString()}.${fraction}`;
}

function parseEth(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error('Enter a valid ETH amount with up to 18 decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
}

export function WalletPanel() {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState('');
  const [balanceWei, setBalanceWei] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [gasFeeWei, setGasFeeWei] = useState<bigint | null>(null);
  const [estimatedValueWei, setEstimatedValueWei] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const connected = Boolean(address);
  const onMainnet = chainId === MAINNET_CHAIN_ID;
  const shortAddress = useMemo(() => address ? `${address.slice(0, 8)}…${address.slice(-6)}` : '', [address]);

  const refreshBalance = useCallback(async (target = address) => {
    if (!target || !ADDRESS_RE.test(target)) return;
    try {
      const response = await fetch(`/api/wallet?address=${encodeURIComponent(target)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to read balance.');
      setBalanceWei(data.balanceWei);
      setBlockNumber(data.blockNumber);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Balance refresh failed.');
    }
  }, [address]);

  useEffect(() => {
    if (!address || !onMainnet) return;
    void refreshBalance(address);
    const timer = window.setInterval(() => void refreshBalance(address), 30_000);
    return () => window.clearInterval(timer);
  }, [address, onMainnet, refreshBalance]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onChainChanged = (nextChain: unknown) => {
      const value = String(nextChain);
      setChainId(value);
      setGasFeeWei(null);
      setEstimatedValueWei(null);
      setMessage(value === MAINNET_CHAIN_ID ? 'Ethereum Mainnet selected.' : 'Network changed. Switch back to Ethereum Mainnet before sending.');
    };
    const onAccountsChanged = (nextAccounts: unknown) => {
      const accounts = Array.isArray(nextAccounts) ? nextAccounts : [];
      const nextAddress = typeof accounts[0] === 'string' && ADDRESS_RE.test(accounts[0]) ? accounts[0] : '';
      setAddress(nextAddress);
      setBalanceWei(null);
      setGasFeeWei(null);
      setEstimatedValueWei(null);
      setTxHash('');
      setTxStatus('');
      setMessage(nextAddress ? 'Wallet account changed.' : 'Wallet disconnected from this site.');
    };
    provider.on('chainChanged', onChainChanged);
    provider.on('accountsChanged', onAccountsChanged);
    return () => {
      provider.removeListener?.('chainChanged', onChainChanged);
      provider.removeListener?.('accountsChanged', onAccountsChanged);
    };
  }, []);

  const connect = async () => {
    setMessage('');
    if (!window.ethereum) {
      setMessage('No injected wallet found. Open this site in MetaMask or install a supported wallet.');
      return;
    }
    setBusy(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const currentChain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      if (!accounts?.[0] || !ADDRESS_RE.test(accounts[0])) throw new Error('Wallet did not return a valid address.');
      setAddress(accounts[0]);
      setChainId(currentChain);
      setMessage(currentChain === MAINNET_CHAIN_ID
        ? 'Wallet connected. Verify the address and details before sending.'
        : 'Wallet connected, but it is not on Ethereum Mainnet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Wallet connection was cancelled or failed.');
    } finally {
      setBusy(false);
    }
  };

  const switchToMainnet = async () => {
    if (!window.ethereum) return;
    setBusy(true);
    setMessage('');
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MAINNET_CHAIN_ID }] });
      const currentChain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      setChainId(currentChain);
      setMessage(currentChain === MAINNET_CHAIN_ID ? 'Ethereum Mainnet selected.' : 'Please select Ethereum Mainnet in your wallet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not switch network.');
    } finally {
      setBusy(false);
    }
  };

  const prepareSend = async () => {
    setMessage('');
    setGasFeeWei(null);
    setEstimatedValueWei(null);
    if (!window.ethereum || !address) { setMessage('Connect your wallet first.'); return; }
    if (!onMainnet) { setMessage('Switch to Ethereum Mainnet before preparing a transfer.'); return; }
    if (!ADDRESS_RE.test(recipient)) { setMessage('Enter a valid 0x recipient address.'); return; }
    if (recipient.toLowerCase() === address.toLowerCase()) {
      setMessage('The recipient is the same as your connected address. Check it before proceeding.');
      return;
    }
    setBusy(true);
    try {
      const value = parseEth(amount);
      if (value <= 0n) throw new Error('Amount must be greater than zero.');
      const [gasRaw, gasPriceRaw, balanceRaw] = await Promise.all([
        window.ethereum.request({ method: 'eth_estimateGas', params: [{ from: address, to: recipient, value: `0x${value.toString(16)}` }] }) as Promise<string>,
        window.ethereum.request({ method: 'eth_gasPrice' }) as Promise<string>,
        window.ethereum.request({ method: 'eth_getBalance', params: [address, 'latest'] }) as Promise<string>,
      ]);
      const gasFee = BigInt(gasRaw) * BigInt(gasPriceRaw);
      if (BigInt(balanceRaw) < value + gasFee) throw new Error('Balance may be insufficient for the amount plus estimated network fee.');
      setEstimatedValueWei(value);
      setGasFeeWei(gasFee);
      setMessage('Review the recipient, amount, and estimated fee below. Nothing has been sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not prepare this transfer.');
    } finally {
      setBusy(false);
    }
  };

  const sendEth = async () => {
    if (!window.ethereum || !address || !onMainnet || estimatedValueWei === null) return;
    const [actualChain, actualAccounts] = await Promise.all([
      window.ethereum.request({ method: 'eth_chainId' }) as Promise<string>,
      window.ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>,
    ]);
    if (actualChain !== MAINNET_CHAIN_ID) {
      setChainId(actualChain);
      setMessage('The wallet network changed. Switch to Ethereum Mainnet and review the transfer again.');
      return;
    }
    if (!actualAccounts[0] || actualAccounts[0].toLowerCase() !== address.toLowerCase()) {
      setAddress(actualAccounts[0] || '');
      setMessage('The active wallet account changed. Review the transfer again.');
      return;
    }
    const fee = gasFeeWei ?? 0n;
    const summary = `Send ${formatEth(estimatedValueWei)} ETH\nTo: ${recipient}\nEstimated network fee: ${formatEth(fee, 8)} ETH\n\nMetaMask will ask for final approval. Continue to MetaMask?`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    setMessage('');
    setTxHash('');
    setTxStatus('Waiting for MetaMask approval…');
    try {
      const [sendChain, sendAccounts] = await Promise.all([
        window.ethereum.request({ method: 'eth_chainId' }) as Promise<string>,
        window.ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>,
      ]);
      if (sendChain !== MAINNET_CHAIN_ID || !sendAccounts[0] || sendAccounts[0].toLowerCase() !== address.toLowerCase()) {
        setChainId(sendChain);
        throw new Error('Wallet account or network changed. No transaction was sent; review the transfer again.');
      }
      const hash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: recipient, value: `0x${estimatedValueWei.toString(16)}` }],
      }) as string;
      if (!TX_RE.test(hash)) throw new Error('Wallet returned an invalid transaction hash.');
      setTxHash(hash);
      setTxStatus('Submitted — waiting for confirmation.');
      setMessage('Transaction submitted by your wallet. Check the transaction details on Etherscan.');
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 4000));
        const response = await fetch(`/api/wallet?tx=${encodeURIComponent(hash)}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.ok && data.status) {
          setTxStatus(data.status === '0x1' ? 'Confirmed successfully.' : 'Transaction failed on-chain.');
          break;
        }
      }
      await refreshBalance(address);
    } catch (error) {
      const err = error as { code?: number; message?: string };
      setTxStatus(err.code === 4001 ? 'Rejected in MetaMask.' : '');
      setMessage(err.code === 4001 ? 'You rejected the transaction. No transfer was authorized.' : (err.message || 'Transaction was not completed.'));
    } finally {
      setBusy(false);
    }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setMessage('Wallet address copied.');
    } catch {
      setMessage('Copy failed. Select and copy the address shown on screen.');
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Ethereum Mainnet · Chain ID 1</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950 dark:text-white">Chainlink Wallet Monitor</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">Read your ETH balance, receive with a QR code, and prepare transfers that require your wallet’s approval.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${connected && onMainnet ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {connected ? (onMainnet ? 'Connected · Mainnet' : 'Wrong network') : 'Wallet disconnected'}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet size={19} /> Wallet</h2>
            {connected && <button onClick={() => void refreshBalance()} disabled={!onMainnet} className="rounded-lg p-2 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" aria-label="Refresh balance"><RefreshCw size={17} /></button>}
          </div>
          {!connected ? (
            <button onClick={() => void connect()} disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Connecting…' : 'Connect Wallet'}</button>
          ) : (
            <>
              <p className="text-sm text-gray-500">Connected address</p>
              <p className="mt-1 break-all font-mono text-sm">{address}</p>
              <p className="mt-1 text-xs text-gray-500">{shortAddress}</p>
              <button onClick={() => void copyAddress()} className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"><Copy size={15} /> Copy address</button>
              <div className="mt-5 rounded-xl bg-gray-50 p-4 dark:bg-gray-800">
                <p className="text-sm text-gray-500">ETH balance</p>
                <p className="mt-1 text-2xl font-semibold">{onMainnet && balanceWei !== null ? `${formatEth(BigInt(balanceWei))} ETH` : '—'}</p>
                <p className="mt-2 text-xs text-gray-500">{blockNumber !== null ? `Read at block ${blockNumber}` : 'Balance read requires server-side QuickNode configuration.'}</p>
              </div>
              {!onMainnet && <button onClick={() => void switchToMainnet()} disabled={busy} className="mt-4 w-full rounded-xl border border-amber-400 px-4 py-3 font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Switch to Ethereum Mainnet</button>}
            </>
          )}
          <p className="mt-4 flex items-start gap-2 text-xs text-gray-500"><ShieldCheck size={15} className="mt-0.5 shrink-0" /> This app never asks for your recovery phrase or private key.</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ArrowDownToLine size={19} /> Receive ETH</h2>
          {connected ? (
            <div className="flex flex-col items-center">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`ethereum:${address}`)}`} alt="QR code for your Ethereum receiving address" width="220" height="220" className="rounded-lg border bg-white p-2" />
              <p className="mt-3 text-center text-sm text-gray-500">Ethereum Mainnet only. Verify the network before sending to this address.</p>
              <p className="mt-2 break-all text-center font-mono text-xs">{address}</p>
              <button onClick={() => void copyAddress()} className="mt-3 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"><QrCode size={16} /> Copy receiving address</button>
            </div>
          ) : <p className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500 dark:bg-gray-800">Connect your wallet to display your receiving QR code.</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:col-span-2 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Send size={19} /> Send ETH</h2>
          <p className="mb-5 text-sm text-gray-500">A transfer is submitted only after you review the details and approve it in MetaMask.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Recipient address
              <input value={recipient} onChange={e => { setRecipient(e.target.value.trim()); setGasFeeWei(null); setEstimatedValueWei(null); }} placeholder="0x…" autoComplete="off" spellCheck={false} className="mt-2 w-full rounded-xl border border-gray-300 bg-transparent px-3 py-3 font-mono text-sm outline-none focus:border-blue-500" />
            </label>
            <label className="block text-sm font-medium">Amount (ETH)
              <input value={amount} onChange={e => { setAmount(e.target.value); setGasFeeWei(null); setEstimatedValueWei(null); }} placeholder="0.01" inputMode="decimal" className="mt-2 w-full rounded-xl border border-gray-300 bg-transparent px-3 py-3 text-sm outline-none focus:border-blue-500" />
            </label>
          </div>
          <button onClick={() => void prepareSend()} disabled={busy || !connected || !onMainnet} className="mt-4 rounded-xl border border-blue-600 px-5 py-3 font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950">{busy ? 'Working…' : 'Review transfer and estimate fee'}</button>
          {estimatedValueWei !== null && gasFeeWei !== null && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">Review before MetaMask</p>
              <p className="mt-2 break-all">To: {recipient}</p>
              <p>Amount: {formatEth(estimatedValueWei)} ETH</p>
              <p>Estimated fee: {formatEth(gasFeeWei, 8)} ETH (can change)</p>
              <button onClick={() => void sendEth()} disabled={busy} className="mt-4 rounded-xl bg-amber-700 px-5 py-3 font-semibold text-white hover:bg-amber-800 disabled:opacity-50">Continue to MetaMask approval</button>
            </div>
          )}
          {txHash && <p className="mt-4 break-all text-sm">Transaction: <a className="inline-flex items-center gap-1 text-blue-600 underline" href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash} <ExternalLink size={13} /></a></p>}
          {txStatus && <p className="mt-2 text-sm font-medium">{txStatus}</p>}
        </div>
      </div>
      {message && <p role="status" className="mt-5 break-words rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">{message}</p>}
      <p className="mt-6 text-xs text-gray-500">Read-only balance queries use the server-configured QuickNode endpoint. Sending is performed by your connected wallet. Review the recipient and network carefully; blockchain transfers are generally irreversible.</p>
    </section>
  );
}
