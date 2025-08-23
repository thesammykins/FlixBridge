# Troubleshooting Guide

> **📖 Flix-Bridge Documentation**  
> [← Multi-Instance](multi-instance.md) | [Next: Architecture →](architecture.md)

Common issues, solutions, and debugging techniques for Flix-Bridge.

## Quick Diagnosis

Start with these basic checks:

```bash
# Test basic connectivity
npm run smoke

# Enable debug logging
FLIX_BRIDGE_DEBUG=1 npm run dev

# Check service responses manually
curl -H "X-Api-Key: your-api-key" http://localhost:8989/api/v3/system/status
```

## Configuration Issues

### Configuration Not Loading

**Symptoms:**
- "No services configured" error
- Services not detected at startup

**Solutions:**
1. **Verify environment variables:**
   ```bash
   # Check slug-based variables
   env | grep -E '^(SONARR|RADARR|SABNZBD)_[A-Z0-9_]+_(URL|API_KEY|NAME)='
   
   # Check single-instance fallback variables
   echo $SONARR_URL $SONARR_API_KEY
   echo $RADARR_URL $RADARR_API_KEY
   echo $SABNZBD_URL $SABNZBD_API_KEY
   ```
2. **Verify slug-based variables:**
   ```bash
   # Check that URL and API_KEY are both set for each slug
   env | grep 'SONARR_.*_URL=' 
   env | grep 'SONARR_.*_API_KEY='
   env | grep 'RADARR_.*_URL='
   env | grep 'RADARR_.*_API_KEY='
   ```
3. **Ensure MCP host passes env vars:**
   - For Claude Desktop, set env under the `env` key for the server entry
   - Restart the host after changes

### Slug Pattern Issues

**Symptoms:**
- Services not being discovered
- "No services configured" error despite setting environment variables

**Solutions:**
1. **Verify slug pattern:**
   ```bash
   # Correct pattern: <SERVICE>_<SLUG>_<FIELD>
   # ✅ Valid: SONARR_MAIN_URL, RADARR_4K_API_KEY
   # ❌ Invalid: SONARR_URL_MAIN, RADARR_API_KEY_4K
   ```

2. **Check slug naming rules:**
   - Use only uppercase letters, numbers, and underscores in slugs
   - No special characters or spaces
   - Examples: `MAIN`, `4K`, `HD`, `ANIME_SERIES`

3. **Verify both URL and API_KEY are set:**
   ```bash
   # Both required for each service
   export SONARR_MAIN_URL="http://localhost:8989"
   export SONARR_MAIN_API_KEY="your-api-key"  # Both needed
   ```

## Service Connection Issues

### API Connection Failed

**Symptoms:**
- "Connection timeout" errors
- "Service unavailable" messages
- HTTP 0 status in error responses

**Solutions:**
1. **Verify base URLs are accessible:**
   ```bash
   # Test connectivity
   curl -v http://localhost:8989/api/v3/system/status
   
   # Check from Flix-Bridge host if different
   telnet your-service-host 8989
   ```

2. **Check API keys:**
   ```bash
   # Test API key manually
   curl -H "X-Api-Key: your-actual-api-key" \
        http://localhost:8989/api/v3/system/status
   ```

3. **Verify service is running:**
   ```bash
   # Check if service processes are running
   ps aux | grep -i sonarr
   ps aux | grep -i radarr
   
   # Check service logs
   tail -f /path/to/sonarr/logs/sonarr.txt
   ```

4. **Network connectivity:**
   ```bash
   # Test port accessibility
   nmap -p 8989 your-service-host
   
   # Check firewall rules
   iptables -L | grep 8989
   ```

### API Permission Denied

**Symptoms:**
- HTTP 401 Unauthorized errors
- "Invalid API key" messages

**Solutions:**
1. **Regenerate API key:**
   - Go to Settings → General → Security
   - Generate new API key
   - Update configuration

2. **Check API key format:**
   - Should be 32-character hexadecimal string
   - No extra spaces or characters
   - Case sensitive

3. **Verify service accepts API keys:**
   - Some services require API key in header vs query parameter
   - Check service documentation for correct format

## Service Detection Issues

### Service Not Found

**Symptoms:**
- "Unknown service" errors
- Service appears in config but not detected

**Solutions:**
1. **Check service naming rules:**
   ```bash
   # Derived service names must contain keywords
   # SONARR_MAIN_* → sonarr-main ✅
   # RADARR_4K_* → radarr-4k ✅
   # TV_MAIN_* → tv-main ❌ (no "sonarr"/"radarr")
   ```

2. **Verify exact service name:**
   ```bash
   # Compare configured service names with tool calls
   # Names are case-sensitive and must match exactly
   ```

3. **Check service registry logs:**
   ```bash
   FLIX_BRIDGE_DEBUG=1 npm run dev
   # Look for "Registered service" messages
   ```

### Wrong Service Type Detection

**Symptoms:**
- TV shows service treated as movies or vice versa
- Incorrect mediaKind in responses

**Solutions:**
1. **Follow naming conventions:**
   - Service names containing "sonarr" → TV series
   - Service names containing "radarr" → Movies
   - Keywords must be in service name, not just URL

2. **Update service names in your environment mapping or variables.**

## Performance Issues

### Slow Response Times

**Symptoms:**
- Operations taking longer than expected
- Timeout errors on large datasets

**Solutions:**
1. **Use pagination for large datasets:**
   ```json
   // Instead of requesting all items
   {"service": "sonarr-main"}
   
   // Use pagination
   {"service": "sonarr-main", "pageSize": 25}
   ```

2. **Target specific instances:**
   ```bash
   # More efficient
   "Check sonarr-main queue"
   
   # Less efficient
   "Check all my services"
   ```

3. **Check service performance:**
   ```bash
   # Monitor service resource usage
   top -p $(pidof Sonarr)
   
   # Check database performance
   # Large databases can slow API responses
   ```

### Memory Issues

**Symptoms:**
- Out of memory errors
- Flix-Bridge process killed

**Solutions:**
1. **Reduce request sizes:**
   ```json
   // Limit page sizes for large queues
   {"pageSize": 25}  // Instead of 100+
   ```

2. **Check Node.js memory limits:**
   ```bash
   # Increase memory if needed
   node --max-old-space-size=4096 dist/index.js
   ```

## Multi-Instance Issues

### Wrong Instance Responding

**Symptoms:**
- Expected sonarr-4k but got sonarr-main response
- Unexpected service field in responses

**Solutions:**
1. **Use exact service names:**
   ```bash
   # Use exact names in requests
   "Check sonarr-4k queue"  # Not "check 4k queue"
   ```

2. **Verify instance network connectivity:**
   ```bash
   # Test each instance individually
   curl -H "X-Api-Key: key1" http://sonarr-main:8989/api/v3/system/status
   curl -H "X-Api-Key: key2" http://sonarr-4k:8990/api/v3/system/status
   ```

### Configuration Conflicts

**Symptoms:**
- Services interfering with each other
- Unexpected cross-instance behavior

**Solutions:**
1. **Check for port conflicts:**
   ```bash
   # Verify each instance uses unique ports
   netstat -tlnp | grep :8989
   netstat -tlnp | grep :8990
   ```

2. **Ensure unique API keys:**
   ```bash
   # Each instance should have its own API key
   # Don't reuse keys across instances
   ```

3. **Verify separate databases:**
   ```bash
   # Each instance should use separate database files
   # Check service config directories
   ```

## Debug Mode

### Enabling Debug Logging

```bash
# Development mode
FLIX_BRIDGE_DEBUG=1 npm run dev

# Production mode
FLIX_BRIDGE_DEBUG=1 npm start

# Smoke tests
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

### Debug Output Interpretation

**Configuration Loading:**
```
[DEBUG] Loaded configuration from environment variables
[DEBUG] Registered service: sonarr-main (type: sonarr)
[DEBUG] Registered service: radarr-4k (type: radarr)
```

**HTTP Requests:**
```
[DEBUG] HTTP GET http://localhost:8989/api/v3/system/status
[DEBUG] Response: 200 OK (456ms)
```

**Service Detection:**
```
[DEBUG] Service 'sonarr-main' detected as type 'sonarr'
[DEBUG] Service 'tv-manager' failed detection (no keyword match)
```

## Diagnostic Tools

### Built-in Diagnostics

```bash
# Run diagnostics on specific service
npm run test:queue-diagnostics

# Test all Phase 2 features
npm run test:phase2

# Debug queue operations specifically
npm run debug:queue
```

### Manual Testing

```bash
# Test service connectivity
for service in sonarr radarr; do
    echo "Testing $service..."
    curl -s -H "X-Api-Key: $API_KEY" \
         "http://localhost:8989/api/v3/system/status" | jq .
done

# Test specific endpoints
curl -H "X-Api-Key: $API_KEY" \
     "http://localhost:8989/api/v3/queue" | jq '.records | length'
```

### Log Analysis

```bash
# Watch service logs in real-time
tail -f /path/to/sonarr/logs/sonarr.txt | grep -i api

# Filter for specific operations
tail -f /path/to/radarr/logs/radarr.txt | grep -i queue

# Check for error patterns
grep -i "error\|exception" /path/to/service/logs/*.txt
```

## Common Error Messages

### "Service not found: service-name"

**Cause:** Service name in request doesn't match configuration
**Fix:** Check exact service names and use them precisely

### "Connection timeout after 5000ms"

**Cause:** Network connectivity issues or service overload
**Fix:** Check service accessibility and consider increasing timeout

### "Invalid API key"

**Cause:** Incorrect API key or format
**Fix:** Regenerate API key from service web interface

### "No services configured"

**Cause:** Configuration not loaded or empty
**Fix:** Verify environment variables or mapping are set correctly

### "Unknown media kind"

**Cause:** Service type not properly detected
**Fix:** Ensure service name contains "sonarr" or "radarr"

## Getting Additional Help

### Information to Gather

Before seeking help, collect:

1. **Version information:**
   ```bash
   node --version
   npm list flix-bridge
   ```

2. **Configuration (sanitized):**
   ```bash
   # Show environment variables (remove API keys before sharing)
   env | grep -E '^(SONARR|RADARR|SABNZBD)_' | sed 's/API_KEY=.*/API_KEY=[REDACTED]/'
   ```

3. **Debug logs:**
   ```bash
   FLIX_BRIDGE_DEBUG=1 npm run smoke 2>&1 | head -50
   ```

4. **Service versions:**
   ```bash
   curl -H "X-Api-Key: $API_KEY" \
        http://localhost:8989/api/v3/system/status | jq .version
   ```

### Smoke Test Results

Always run and share smoke test results:

```bash
npm run smoke
```

Expected output:
```
✅ sonarr-main: System Status - OK (v4.0.0.746)
✅ radarr-4k: System Status - OK (v5.3.6.8612)
✅ sabnzbd-main: Connection test - OK
```

---

**Next Steps:**
- **[Architecture →](architecture.md)** - Technical architecture and extension guide
- **[Configuration →](configuration.md)** - Review configuration options
- **[Installation →](installation.md)** - Verify setup steps

---
*Part of the [Flix-Bridge](../README.md) documentation*

> **📖 Flix-Bridge Documentation**  
> [← Multi-Instance](multi-instance.md) | [Next: Architecture →](architecture.md)

Common issues, solutions, and debugging techniques for Flix-Bridge.

## Quick Diagnosis

Start with these basic checks:

```bash
# Test basic connectivity
npm run smoke

# Enable debug logging
FLIX_BRIDGE_DEBUG=1 npm run dev

# Check service responses manually
curl -H "X-Api-Key: your-api-key" http://localhost:8989/api/v3/system/status
```

## Configuration Issues

### Configuration Not Loading

**Symptoms:**
- "No services configured" error
- Services not detected at startup

**Solutions:**
1. **Verify environment variables:**
   ```bash
   # List all FLIX_BRIDGE related env vars
   env | grep -i flix
   
   # Check standard variables
   echo $SONARR_URL $SONARR_API_KEY
   echo $RADARR_URL $RADARR_API_KEY
   echo $SABNZBD_URL $SABNZBD_API_KEY
   ```
2. **Check FLIX_BRIDGE_ENV_MAPPING:**
   ```bash
   # Ensure your mapping is valid JSON
   echo $FLIX_BRIDGE_ENV_MAPPING | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')))"
   ```
3. **Ensure MCP host passes env vars:**
   - For Claude Desktop, set env under the `env` key for the server entry
   - Restart the host after changes

### Environment Variable Mapping Issues

**Symptoms:**
- Variables not mapping correctly
- "Custom mapping failed to load" error

**Solutions:**
1. **Validate mapping JSON:**
   ```bash
   # Test mapping structure
   echo $FLIX_BRIDGE_ENV_MAPPING | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')))"
   ```

2. **Check referenced variables exist:**
   ```bash
   # For each variable in your mapping, verify it's set
   env | grep MCP_SONARR_BASE_URL
   env | grep MCP_SONARR_API_KEY
   ```

3. **Escape mapping properly in MCP config:**
   ```json
   // Correct escaping for JSON
   "FLIX_BRIDGE_ENV_MAPPING": "{\"services\":{\"sonarr\":{\"baseUrl\":\"VAR_NAME\"}}}"
   ```

## Service Connection Issues

### API Connection Failed

**Symptoms:**
- "Connection timeout" errors
- "Service unavailable" messages
- HTTP 0 status in error responses

**Solutions:**
1. **Verify base URLs are accessible:**
   ```bash
   # Test connectivity
   curl -v http://localhost:8989/api/v3/system/status
   
   # Check from Flix-Bridge host if different
   telnet your-service-host 8989
   ```

2. **Check API keys:**
   ```bash
   # Test API key manually
   curl -H "X-Api-Key: your-actual-api-key" \
        http://localhost:8989/api/v3/system/status
   ```

3. **Verify service is running:**
   ```bash
   # Check if service processes are running
   ps aux | grep -i sonarr
   ps aux | grep -i radarr
   
   # Check service logs
   tail -f /path/to/sonarr/logs/sonarr.txt
   ```

4. **Network connectivity:**
   ```bash
   # Test port accessibility
   nmap -p 8989 your-service-host
   
   # Check firewall rules
   iptables -L | grep 8989
   ```

### API Permission Denied

**Symptoms:**
- HTTP 401 Unauthorized errors
- "Invalid API key" messages

**Solutions:**
1. **Regenerate API key:**
   - Go to Settings → General → Security
   - Generate new API key
   - Update configuration

2. **Check API key format:**
   - Should be 32-character hexadecimal string
   - No extra spaces or characters
   - Case sensitive

3. **Verify service accepts API keys:**
   - Some services require API key in header vs query parameter
   - Check service documentation for correct format

## Service Detection Issues

### Service Not Found

**Symptoms:**
- "Unknown service" errors
- Service appears in config but not detected

**Solutions:**
1. **Check service naming rules:**
   ```bash
   # Service names must contain keywords
   # ✅ Valid: sonarr-main, radarr-4k
   # ❌ Invalid: tv-manager, movie-server
   ```

2. **Verify exact service name:**
   ```bash
   # Compare config service names with tool calls
   # Names are case-sensitive and must match exactly
   ```

3. **Check service registry logs:**
   ```bash
   FLIX_BRIDGE_DEBUG=1 npm run dev
   # Look for "Registered service" messages
   ```

### Wrong Service Type Detection

**Symptoms:**
- TV shows service treated as movies or vice versa
- Incorrect mediaKind in responses

**Solutions:**
1. **Follow naming conventions:**
   - Service names containing "sonarr" → TV series
   - Service names containing "radarr" → Movies
   - Keywords must be in service name, not just URL

2. **Fix slug naming:**
   ```bash
   # Use proper service prefixes in environment variables
   TV_MAIN_URL → SONARR_MAIN_URL
   MOVIE_4K_URL → RADARR_4K_URL
   ```

3. **Use custom names if needed:**
   ```bash
   # Override derived name while keeping detection
   export SONARR_MAIN_URL="http://localhost:8989"
   export SONARR_MAIN_API_KEY="your-key"
   export SONARR_MAIN_NAME="sonarr-custom-name"  # Must contain "sonarr"
   ```

## Performance Issues

### Slow Response Times

**Symptoms:**
- Operations taking longer than expected
- Timeout errors on large datasets

**Solutions:**
1. **Use pagination for large datasets:**
   ```json
   // Instead of requesting all items
   {"service": "sonarr-main"}
   
   // Use pagination
   {"service": "sonarr-main", "pageSize": 25}
   ```

2. **Target specific instances:**
   ```bash
   # More efficient
   "Check sonarr-main queue"
   
   # Less efficient
   "Check all my services"
   ```

3. **Check service performance:**
   ```bash
   # Monitor service resource usage
   top -p $(pidof Sonarr)
   
   # Check database performance
   # Large databases can slow API responses
   ```

### Memory Issues

**Symptoms:**
- Out of memory errors
- Flix-Bridge process killed

**Solutions:**
1. **Reduce request sizes:**
   ```json
   // Limit page sizes for large queues
   {"pageSize": 25}  // Instead of 100+
   ```

2. **Check Node.js memory limits:**
   ```bash
   # Increase memory if needed
   node --max-old-space-size=4096 dist/index.js
   ```

## Multi-Instance Issues

### Wrong Instance Responding

**Symptoms:**
- Expected sonarr-4k but got sonarr-main response
- Unexpected service field in responses

**Solutions:**
1. **Use exact service names:**
   ```bash
   # Check discovered service names in debug output
   FLIX_BRIDGE_DEBUG=1 npm run dev
   # Look for "Discovered [Service] service: service-name"
   
   # Use exact names in requests
   "Check sonarr-4k queue"  # Not "check 4k queue"
   ```

2. **Verify instance network connectivity:**
   ```bash
   # Test each instance individually
   curl -H "X-Api-Key: key1" http://sonarr-main:8989/api/v3/system/status
   curl -H "X-Api-Key: key2" http://sonarr-4k:8990/api/v3/system/status
   ```

### Configuration Conflicts

**Symptoms:**
- Services interfering with each other
- Unexpected cross-instance behavior

**Solutions:**
1. **Check for port conflicts:**
   ```bash
   # Verify each instance uses unique ports
   netstat -tlnp | grep :8989
   netstat -tlnp | grep :8990
   ```

2. **Ensure unique API keys:**
   ```bash
   # Each instance should have its own API key
   # Don't reuse keys across instances
   ```

3. **Verify separate databases:**
   ```bash
   # Each instance should use separate database files
   # Check service config directories
   ```

## Debug Mode

### Enabling Debug Logging

```bash
# Development mode
FLIX_BRIDGE_DEBUG=1 npm run dev

# Production mode
FLIX_BRIDGE_DEBUG=1 npm start

# Smoke tests
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

### Debug Output Interpretation

**Configuration Loading:**
```
[Config] Discovered Sonarr service: sonarr-main (slug: MAIN)
[Config] Discovered Radarr service: radarr-4k (slug: 4K)
[Config] Total discovered services: 2
✅ Registered service: sonarr-main
✅ Registered service: radarr-4k
```

**HTTP Requests:**
```
[DEBUG] HTTP GET http://localhost:8989/api/v3/system/status
[DEBUG] Response: 200 OK (456ms)
```

**Service Detection:**
```
[DEBUG] Service 'sonarr-main' detected as type 'sonarr'
[DEBUG] Service 'tv-manager' failed detection (no keyword match)
```

## Diagnostic Tools

### Built-in Diagnostics

```bash
# Run diagnostics on specific service
npm run test:queue-diagnostics

# Test all Phase 2 features
npm run test:phase2

# Debug queue operations specifically
npm run debug:queue
```

### Manual Testing

```bash
# Test service connectivity
for service in sonarr radarr; do
    echo "Testing $service..."
    curl -s -H "X-Api-Key: $API_KEY" \
         "http://localhost:8989/api/v3/system/status" | jq .
done

# Test specific endpoints
curl -H "X-Api-Key: $API_KEY" \
     "http://localhost:8989/api/v3/queue" | jq '.records | length'
```

### Log Analysis

```bash
# Watch service logs in real-time
tail -f /path/to/sonarr/logs/sonarr.txt | grep -i api

# Filter for specific operations
tail -f /path/to/radarr/logs/radarr.txt | grep -i queue

# Check for error patterns
grep -i "error\|exception" /path/to/service/logs/*.txt
```

## Common Error Messages

### "Service not found: service-name"

**Cause:** Service name in request doesn't match configuration
**Fix:** Check exact service names in config.json and use them precisely

### "Connection timeout after 5000ms"

**Cause:** Network connectivity issues or service overload
**Fix:** Check service accessibility and consider increasing timeout

### "Invalid API key"

**Cause:** Incorrect API key or format
**Fix:** Regenerate API key from service web interface

### "No services configured"

**Cause:** No valid slug-based or fallback environment variables found
**Fix:** Set proper environment variables following the slug pattern or single-instance fallback

### "Server starts but immediately exits when run via npx"

**Cause:** Fixed in v0.3.2 - main module detection was failing with npx
**Fix:** Update to v0.3.2 or later: `npx @thesammykins/flixbridge@latest`

### "Unknown media kind"

**Cause:** Service type not properly detected
**Fix:** Ensure service name contains "sonarr" or "radarr"

## Getting Additional Help

### Information to Gather

Before seeking help, collect:

1. **Version information:**
   ```bash
   node --version
   npm list flix-bridge
   ```

2. **Configuration (sanitized):**
   ```bash
   # Show environment variables (remove API keys before sharing)
   env | grep -E '^(SONARR|RADARR|SABNZBD)_' | sed 's/API_KEY=.*/API_KEY=[REDACTED]/'
   ```

3. **Debug logs:**
   ```bash
   FLIX_BRIDGE_DEBUG=1 npm run smoke 2>&1 | head -50
   ```

4. **Service versions:**
   ```bash
   curl -H "X-Api-Key: $API_KEY" \
        http://localhost:8989/api/v3/system/status | jq .version
   ```

### Smoke Test Results

Always run and share smoke test results:

```bash
npm run smoke
```

Expected output:
```
✅ sonarr-main: System Status - OK (v4.0.0.746)
✅ radarr-4k: System Status - OK (v5.3.6.8612)
✅ sabnzbd: Connection test - OK
```

---

**Next Steps:**
- **[Architecture →](architecture.md)** - Technical architecture and extension guide
- **[Configuration →](configuration.md)** - Review configuration options
- **[Installation →](installation.md)** - Verify setup steps

---
*Part of the [Flix-Bridge](../README.md) documentation*
