-- KEYS[1] = counter key (remaining tickets)
-- KEYS[2] = stream key
-- ARGV[1] = reservation id (uuid)
-- ARGV[2] = timestamp (ms, as string)
--
-- Atomically checks, decrements, and records the reservation event in the
-- stream — all in one Redis operation, so a ticket can never be decremented
-- without a corresponding stream entry (or vice versa). Folding the XADD in
-- here (rather than doing it as a second round-trip after the script
-- returns) is what makes that guarantee hold even if the process crashes
-- or the connection drops between the two calls.
local remaining = redis.call('GET', KEYS[1])
if remaining == false then
  return -1
end
if tonumber(remaining) > 0 then
  redis.call('DECR', KEYS[1])
  redis.call('XADD', KEYS[2], '*', 'reservationId', ARGV[1], 'timestamp', ARGV[2])
  return 1
else
  return 0
end
