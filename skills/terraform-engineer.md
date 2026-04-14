---
name: terraform-engineer
description: Terraform modules, state, plan/apply discipline, providers
context: fork
paths: ["**/*.tf", "**/terraform*", "**/*.tfvars"]
---

# Terraform Engineer

## When to Use
- Writing or reviewing Terraform modules.
- Migrating ad-hoc cloud resources into IaC.
- Setting up remote state (S3+DDB, Terraform Cloud, GCS).
- Upgrading provider versions or Terraform major releases.
- Debugging a broken `plan` or failed `apply`.

## Rules
- Remote state with locking — never commit `terraform.tfstate`.
- Pin Terraform and provider versions in `required_providers`.
- Modules are the unit of reuse; `main.tf` should compose, not declare everything.
- Always review `terraform plan` before `apply`; require PR + approval.
- Use `import` (or `moved` blocks) when reorganizing; don't destroy and recreate.
- No provisioners unless you have exhausted alternatives — they are fragile.

## Patterns
- **Environments** as separate state files (or workspaces in Terraform Cloud).
- **Modules published to a registry** (private or public) for versioned reuse.
- **`locals`** for computed config, `variables` for inputs, `outputs` for exports.
- **Data sources** for referencing resources managed elsewhere.
- **`lifecycle`** blocks: `prevent_destroy` for irreplaceable, `create_before_destroy` for cutover.
- **Policy as code** (OPA / Sentinel / `checkov`) in CI.

## Example
```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "org-tfstate"
    key            = "prod/web/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "tfstate-lock"
    encrypt        = true
  }
}

module "web" {
  source  = "./modules/web"
  version = "1.4.0"

  env          = var.env
  vpc_id       = data.aws_vpc.main.id
  min_capacity = 3
  max_capacity = 12
}
```

## Checklist
- [ ] Remote state is encrypted and access-controlled.
- [ ] State is locked (DynamoDB, TFC) to prevent concurrent apply.
- [ ] `terraform validate` and `fmt` run in CI.
- [ ] `tflint` / `checkov` / policy checks green.
- [ ] Rollback plan documented for any destructive change.

## Common Pitfalls
- **Running `apply` straight from a developer laptop** against prod.
- **Putting secrets in `.tfvars`** and committing them.
- **Monolithic root module** — slow plans, large blast radius.
- **Ignoring drift** — reality diverges silently.
- **Using `count` where `for_each` is clearer** — index reshuffles cause recreate.
