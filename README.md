# MCP Terminal Server

Implements the `run_terminal_cmd` tool for the Model Context Protocol (MCP) over standard input/output (stdio).

## Features

*   Acts as an MCP server communicating via stdio.
*   Provides the `run_terminal_cmd` tool.
    *   Executes shell commands locally.
    *   Supports command approval workflow (`require_user_approval`).
    *   Handles background command execution (`is_background`).
    *   Includes timeouts and output truncation.
    *   Supports automatic command approval via configuration.

## Prerequisites

*   Node.js (v18+)
*   npm
*   Docker (optional, for containerized deployment)
*   Docker Compose (optional)

## Setup and Running

**1. Clone the repository (if applicable)**

```bash
# git clone <repository_url>
# cd mcp-terminal
```

**2. Install dependencies**

```bash
npm install
```

**3. Build TypeScript**

```bash
npm run build
```

**4. Run the server**

```bash
npm start
# or
node dist/server.js
```

The server will start listening for MCP requests on stdin and sending responses/logs to stdout/stderr.

**Running with Auto-Approval Configuration:**

```bash
node dist/server.js --file autorun.json
```

See the [Configuration](#configuration) section for details on the format.

**Running with Docker Compose:**

```bash
docker compose up --build -d # Run in detached mode
# Interact with the running container:
docker compose exec -it mcp-terminal /bin/sh # Example: opens a shell
# Or send MCP requests via docker compose run (needs careful input piping)
```
*Note: Interacting with a stdio service via Docker Compose requires careful handling of input/output streams.* You might pipe MCP JSON requests directly or use a client designed for MCP stdio communication.

## Configuration

The server can be configured to automatically approve certain commands, eliminating the need for explicit user confirmation when `require_user_approval` is set to `true`.

Configuration is loaded from a JSON file specified with the `--file` command-line argument:

```bash
node dist/server.js --file autorun.json
```

### Configuration Format

```json
{
  "autorun_mode": {
    "enabled": true,
    "allowlist": ["ls", "echo", "cat"],
    "denylist": ["rm", "git commit", "git push"],
    "allow_all_other_commands": false
  }
}
```

- `enabled`: Enables/disables the auto-approval feature
- `allowlist`: Array of command substrings that will be automatically approved
- `denylist`: Array of command substrings that will never be auto-approved (overrides allowlist)
- `allow_all_other_commands`: If true, all commands not in the denylist will be auto-approved

### Auto-Approval Logic

1. If `enabled` is `false`, no commands are auto-approved
2. Check if the command contains any substring in the `denylist` - if so, deny auto-approval
3. Check if the command contains any substring in the `allowlist` - if so, approve
4. Use `allow_all_other_commands` setting as the default

## Usage (MCP Interaction)

Interaction with this server happens via the Model Context Protocol over stdio.
A client application (like an AI agent orchestrator) would typically manage this.

1.  **Start the server:** Run `npm start` or use Docker.
2.  **Send MCP Requests (as JSON lines) to server's stdin:**

    *   **List Tools:**
        ```json
        {"jsonrpc":"2.0","id":1,"method":"tools/list"}
        ```

    *   **Call `run_terminal_cmd` (Example):**
        ```json
        {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mcp_run_terminal_cmd","id":"call_123","arguments":{"command":"echo Hello MCP","explanation":"Simple echo command","is_background":false,"require_user_approval":false}}}
        ```

    *   **Call `run_terminal_cmd` (Requiring Approval):**
        ```json
        {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mcp_run_terminal_cmd","id":"call_abc","arguments":{"command":"ls -la","explanation":"List files","is_background":false,"require_user_approval":true}}}
        ```

3.  **Receive MCP Responses (as JSON lines) from server's stdout:**

    *   **List Tools Response:** (Contains `mcp_run_terminal_cmd` definition)
    *   **Call Tool Response (Success):**
        ```json
        {"jsonrpc":"2.0","id":2,"result":{"toolCallId":"call_123","content":[{"type":"text","text":"{\"stdout\":\"Hello MCP\\n\",\"stderr\":\"\",\"exitCode\":0}"}]}}
        ```
    *   **Call Tool Response (Waiting):**
        ```json
        {"jsonrpc":"2.0","id":3,"result":{"toolCallId":"call_abc","content":[{"type":"text","text":"{\"status\":\"waiting_for_approval\"}"}]}}
        ```
    *   **Call Tool Response (Approved after waiting):** Send the same call again with `require_user_approval: false`.
        ```json
        {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mcp_run_terminal_cmd","id":"call_abc","arguments":{"command":"ls -la","explanation":"List files","is_background":false,"require_user_approval":false}}}
        ```
        *(Server sends result for toolCallId `call_abc`)*

4.  **Server Logs:** Diagnostic information is sent to stderr.

## Testing

(Autotests removed as per request. Manual testing via MCP client is needed.)

```bash
# npm test # (Currently no tests defined)
```

## Linting

```bash
npm run lint       # Check for lint errors
npm run lint:fix # Attempt to automatically fix lint errors
```
