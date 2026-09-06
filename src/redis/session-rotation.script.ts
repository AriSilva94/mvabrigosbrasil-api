/**
 * Atomically rotates a refresh token, recovers an immediately preceding
 * rotation, or revokes a session on an invalid token. The grace key retains
 * the raw successor for five seconds so concurrent browser/proxy requests can
 * converge on one token; outside that narrow replay window, reuse still
 * triggers theft detection.
 *
 * This script targets the application's current single-Redis deployment. A
 * future Redis Cluster migration must put the session, grace, and user-session
 * keys in one hash slot before this multi-key operation can be used there.
 */
export const ROTATE_SESSION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {0}
end

local decoded, stored = pcall(cjson.decode, raw)
if not decoded then
  return redis.error_reply('invalid session JSON')
end
if type(stored) ~= 'table' or type(stored.userId) ~= 'string' or type(stored.rtHash) ~= 'string' then
  return redis.error_reply('invalid session record')
end

if stored.rtHash == ARGV[2] then
  stored.rtHash = ARGV[4]
  redis.call('SET', KEYS[1], cjson.encode(stored), 'EX', ARGV[5])
  redis.call('EXPIRE', ARGV[7] .. stored.userId, ARGV[5])
  local graceRecord = cjson.encode({rt = ARGV[3], rtHash = ARGV[4]})
  redis.call('SET', KEYS[2], graceRecord, 'EX', ARGV[6])
  return {1, ARGV[3]}
end

local graceRaw = redis.call('GET', KEYS[2])
if graceRaw then
  local graceDecoded, grace = pcall(cjson.decode, graceRaw)
  if graceDecoded and type(grace) == 'table' and type(grace.rt) == 'string' and grace.rtHash == stored.rtHash then
    return {2, grace.rt}
  end
end

redis.call('DEL', KEYS[1])
redis.call('SREM', ARGV[7] .. stored.userId, ARGV[1])
return {0}
`;
