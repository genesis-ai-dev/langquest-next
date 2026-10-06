/**
 * Sync protocol version this client speaks. Sent with every append and pull;
 * the server refuses clients below its `server_config.min_client_version`
 * with a distinct error so the app can say "upgrade" instead of silently
 * folding a stream it can no longer read correctly. Bump when an event or
 * RPC change makes older clients unsafe, not on every reducer change.
 */
export const CLIENT_PROTOCOL_VERSION = 1;
