# Chainlink Wallet Monitor setup

## Network and safety
- Network: Ethereum Mainnet (chain ID 1).
- Wallet connection is initiated only by the user's Connect Wallet button.
- ETH transfers are requested through the connected wallet's `eth_sendTransaction` method, which prompts the wallet for approval.
- The app never asks for private keys or recovery phrases.
- No contract deployment is required for a basic ETH transfer.

## QuickNode server configuration
Configure this environment variable in the server/runtime hosting settings (not as a public browser variable):

```bash
ETHEREUM_RPC_URL=https://YOUR-ETHEREUM-MAINNET-ENDPOINT
```

Use the HTTPS endpoint copied from your QuickNode Ethereum Mainnet endpoint. Never commit the real endpoint or its API key. The server route checks chain ID 1 before returning balance or receipt data. Without this variable, the route fails closed; it does not fall back to a public RPC.

For local development, put the variable in a local `.env.local` file and ensure that file is git-ignored. Do not use a `NEXT_PUBLIC_` prefix.

## Run and verify
```bash
pnpm install
pnpm dev
``

Open the app, click Connect Wallet, and approve account access only after verifying the site and account in your wallet. Verify Ethereum Mainnet before preparing any transfer. The Receive QR uses the connected public address; do not send funds until the displayed address and network have been checked carefully.

## Transaction behavior
The UI validates the recipient and amount, estimates gas through the wallet provider, shows a review step, and then calls `eth_sendTransaction` only after the user chooses Continue to MetaMask approval. MetaMask displays the final transaction confirmation. The app itself does not store or handle private keys.

The receive QR image is currently rendered through a third-party QR image service using only the public wallet address. If you prefer no third-party QR request, replace it with a locally bundled QR library and update the package lockfile.
