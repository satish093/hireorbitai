# Infrastructure

Scripts and templates that provision the VPS the app runs on. Run **once per host**, before the first deploy.

The application deployment itself lives in [`scripts/`](../scripts/) (`deploy.sh`, `update.sh`, etc.) and is documented in [docs/deployment/cloudpanel.md](../docs/deployment/cloudpanel.md).

## Contents

| File                                                 | Purpose                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`bootstrap-vps.sh`](bootstrap-vps.sh)               | Idempotent root-level setup: apt packages, Node 22, PM2, Postgres 16, the app OS user, the DB role + database, UFW basics. |
| [`cloud-init.example.yaml`](cloud-init.example.yaml) | Drop-in user-data for a Hostinger / DigitalOcean / Hetzner provision flow — runs `bootstrap-vps.sh` on first boot.         |

## Why not Terraform / Pulumi?

The deployment target is **a single Hostinger KVM behind CloudPanel**. Terraform is great when you have multiple environments to provision identically across an IaaS-shaped API (AWS, GCP, Azure). For one VPS with a UI-driven control plane (CloudPanel), it adds a layer with no payoff — the bootstrap script + cloud-init covers the whole story. Revisit Terraform when there's >1 environment that needs identical provisioning.

## Manual run

```bash
# On the VPS as root:
curl -fsSL https://raw.githubusercontent.com/<you>/hireorbitai/main/infrastructure/bootstrap-vps.sh \
  -o bootstrap-vps.sh
chmod +x bootstrap-vps.sh
sudo APP_USER=hireorbitai DB_PASSWORD='<pick-one>' ./bootstrap-vps.sh
```

The script is idempotent — re-running on an already-provisioned box is a series of no-ops.

## What runs AFTER bootstrap

1. Install CloudPanel (their installer is interactive — not in this script).
2. Add your SSH public key to `/home/hireorbitai/.ssh/authorized_keys`.
3. As the `hireorbitai` user, follow [docs/deployment/cloudpanel.md](../docs/deployment/cloudpanel.md) from §3 onwards.
