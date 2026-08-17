/**
 * Verify that what this repository claims to have published still matches what
 * its tags actually hold.
 *
 * This is the gate that makes an exact-version URL mean something. A rewritten
 * tag, an edited ledger, or a change to the way pinned copies are derived all
 * show up here as a red build rather than as a silently altered artifact on a
 * URL the README calls immutable forever.
 *
 * NON-NORMATIVE, like everything under tools/.
 */
import {
  discoverReleases,
  LEDGER_FILE,
  pendingNotices,
  readLedger,
  verifyPublications,
} from './released.ts'
import { Failures, REPO_ROOT } from './spec.ts'

function main(): void {
  const failures = new Failures()
  verifyPublications(REPO_ROOT, failures)

  for (const notice of pendingNotices(REPO_ROOT)) {
    console.log(`  · ${notice}`)
  }

  // Report what was actually checked. A pending release — recorded but not yet
  // tagged — is verified against the working tree, and saying "nothing to
  // verify" there would describe a real check as a no-op.
  const tagged = discoverReleases(REPO_ROOT).length
  const recorded = Object.keys(readLedger(REPO_ROOT).releases).length
  const pending = recorded - tagged

  const parts: string[] = []
  if (tagged > 0) parts.push(`${tagged} published version(s)`)
  if (pending > 0) parts.push(`${pending} pending release(s)`)

  failures.report(
    parts.length === 0
      ? `Nothing released or pending — ${LEDGER_FILE} is empty.`
      : `Verified ${parts.join(' and ')} against ${LEDGER_FILE}.`,
  )
}

if (import.meta.main) main()
