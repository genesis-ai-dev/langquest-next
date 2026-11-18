# 244. Proof of a key signs a chain's account in until the key's first session

Date: 2026-11-12 · By: Carl Sauder · Status: accepted

Reason: Carl's answer 10: a newcomer has no password and no helper code at
first contact, so proof of their key signs them in, but only until that
key's first session, recorded as `install_keys.first_session_at`; after
that, a helper's code as for anyone. `nearby_join_finish` returns a session
only for an account whose `app_metadata.chain_key` is this key, that is
looked after, with the key's row unrevoked and no first session yet, so an
ordinary account's certified key gets nothing, however it got its row. The
route never writes `first_session_at`: `nearby_certificate_facts` does, on
all of that person's rows, because it holds a bearer token, and the phone
calls the certificate route straight after adopting the session, whatever
the flag says, until it succeeds. Both `take_sign_in_code` functions close
the same rows, so a helper's code on another phone ends it too. So a lost
reply can be retried whenever the phone next gets a signal, and a repeat has
no more power than a first try. Amends 75.
Reverse if: a key is taken between the join and the first certificate
often enough that a shorter window is worth retries failing.

Amended (2026-11-08, Carl Sauder): a local person whose key no longer signs
in (`needsCode`) redeems a helper's code made for them, so the phone's
client lets `sign-in-code` go as no one while a local person holds it,
which every other request does not, and sends their id with the code. The
function then calls `take_sign_in_code_for`, which refuses a live code made
for anyone else before taking it (403, "made for someone else"), because the
phone takes only a session for its own id: taken first, the code would be
spent and that person's key sign-in closed for nothing. A build that sends
no id is answered by `take_sign_in_code_v2` as before. Migration
`20261112060000_sign_in_code_for.sql`.
