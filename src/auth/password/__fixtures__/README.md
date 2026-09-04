# Legacy Hash Fixtures

## Overview

This directory contains synthetic password hash fixtures for all legacy hash formats supported by `PasswordService.verify()`.

## Current State: Synthetic Fixtures

**These hashes are synthetic (generated programmatically), not from production.**

All fixtures represent the password `TESTE_SENHA_2025` (the test account password documented in the project's password reset procedures).

### Fixture Format

Each fixture is an object with:
- `format`: Hash algorithm identifier (`"gotrue"`, `"wp"`, `"phpass"`, `"md5"`)
- `hash`: The actual hash value
- `password`: The plain text password these fixtures represent
- `synthetic`: Boolean flag; `true` for synthetic, `false` for real production hashes

## Replacing with Real Hashes

The fixture test is designed to catch regressions in `PasswordService` when a real production hash export becomes available. To swap in real hashes:

1. **Export from production database:**
   - Query `wp_users_legacy.user_pass` for one row each with format `"wp"`, `"phpass"`, and `"md5"`
   - Query `auth.users.encrypted_password` for one Supabase GoTrue hash (format `"gotrue"`)
   - Select accounts whose passwords are known or can be reset to `TESTE_SENHA_2025`

2. **Update fixtures:**
   - Replace the `"hash"` field for each format with the real hash from production
   - Set `"synthetic": false` for each entry
   - Leave `"format"` and `"password"` unchanged
   - Do not modify the test spec; it will continue to work as-is

3. **Verification:**
   - Run `npm test -- fixtures` to confirm all formats still pass
   - This confirms the real hashes are compatible with the current implementation

## Verification Note

**A real-hash run is still a pending verification item.** These synthetic fixtures cannot definitively prove compatibility with hashes produced by the actual production WordPress installation. The synthetic hashes follow the documented algorithms, but quirks or version-specific behavior in the actual WordPress system may differ.

Real hashes from production will be the definitive test of compatibility.
