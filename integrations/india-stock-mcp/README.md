# india-stock-mcp (remote HTTP wrapper)

Wraps the [india-stock-mcp](https://github.com/Akhilgovind02/india-stock-mcp) npm
package — which pulls real NSE India data (via `nse-bse-api`, falling back to Yahoo
only where NSE's endpoints aren't public) — as a remote Streamable HTTP MCP server,
using [supergateway](https://github.com/supercorp-ai/supergateway) to bridge its
stdio transport to HTTP without modifying its source.

Added because `IndiaQuant-MCP` (the other integration in this repo) sources options
chain data from Yahoo Finance via `yfinance`, and Yahoo does not carry NSE/BSE
options data at all — `get_options_chain` fails there for every symbol. This
package hits NSE's own option-chain endpoint instead, and actually returns strikes,
OI, IV, and volume for CE/PE.

16 tools: `get_quote`, `get_historical`, `search_symbol`, `get_fundamentals`,
`compare_stocks`, `get_index`, `get_market_status`, `get_gainers_losers`,
`get_corporate_actions`, `get_options_chain`, `get_ipo_list`, `search_funds`,
`get_fund_nav`, `get_fund_details`, `compare_funds`, `portfolio_summary`.

## Known limitation

`nse-bse-api` depends on `adm-zip`, which has an unfixed high-severity advisory
(a crafted ZIP can trigger a large memory allocation). Low real-world risk here
since the ZIPs it parses come from NSE's own servers, not user input — but worth
knowing before relying on this in anything more sensitive than personal market data.
NSE may also rate-limit or block heavy usage; there's no documented limit.

## Deploying on Render

Same pattern as `IndiaQuant-MCP`'s `render.yaml`, but simpler — pure Node, no Python
version pinning needed:

- **Root Directory**: `integrations/india-stock-mcp`
- **Language**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: Free

No environment variables required — this package doesn't need API keys.

Once deployed, the MCP endpoint is `https://<your-service>.onrender.com/mcp`. Add it
as a custom connector in Claude the same way as IndiaQuant-MCP.
