# The lines of a Recoil infolog that scripts/compat-proof.sh counts as errors.
# Usage: awk -f scripts/compat-proof-errors.awk infolog.txt
{
  line = $0
  sub(/^(\[[tf]=[^]]*\])+ */, "", line)
  if (line ~ /^(\[[^]]*\] )?Warning:/) next
  # "Failed to load:" is what a widget, gadget or shader handler logs when a
  # file does not load. It carries no "error", so it needs its own test.
  if (/Error/ || ((/LuaRules/ || /LuaUI/) && tolower($0) ~ /error/) || /Failed to load:/) print
}
