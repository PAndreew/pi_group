# Native Pi profiles

Beezy can run each sender’s turn with their own native Pi profile. Pi makes provider calls directly, including Codex OAuth refresh. Beezy keeps the session transcript shared and reopens the same file under the next sender’s profile when the prior run is idle. No model gateway is required.

In **Model settings → Providers**, users can save one API-key connection to a Beezy-managed Pi profile. Then select a model in **Defaults → Pi RPC**. An admin can choose a **Workspace fallback** from the server’s existing Pi login, including OpenAI Codex. It applies only when the preferred and personal fallback models are unavailable before the turn; Beezy does not replay provider failures. The web UI does not initiate OAuth sign-ins, and keys are stored in Pi’s native auth file, not encrypted at rest.

For OAuth or administrator-managed profiles:

1. Set `BEEZY_PI_PROFILES_FILE` in the Beezy server environment to an absolute path to an administrator-managed JSON file. Map stable Beezy user IDs (from `/api/auth/me` or the admin users API) to absolute Pi configuration directories, for example `{ "account-id": "/home/pi/.config/beezy/profiles/alice" }`.
2. In each profile, sign in using Pi itself: `PI_CODING_AGENT_DIR=/absolute/profile/path pi`, then `/login`. To use an existing login, point the mapping at that existing profile rather than copying its tokens. Do not commit auth files. Users without a mapping continue to use the server’s normal Pi configuration.
3. In Beezy, choose **Model settings → Defaults → Pi RPC**, then select a preferred model and an optional fallback. These are loaded from the assigned profile. The fallback applies only when the preferred model is unavailable before the turn, not after a provider error. Both models use the same profile.

Wait for the active run to settle before submitting another personal-profile turn. The shared transcript may be sent to different providers as people take turns. A Pi profile separates credential selection, not filesystem access: native Pi credentials use Pi’s own on-disk storage, and agent tools running under the same OS account can read files that account can access. Use only with trusted users unless you isolate tool execution and credential files at the OS level.
