# TerraGate v2 project policies

These are authored portfolio-project defaults, not AWS mandates or compliance certification. The selected saved policy pack is authoritative when its values differ.

- Production deletion or replacement of RDS, EBS, EFS, DynamoDB or S3 stateful resources is critical. Require owner signoff, a tested restore point, migration/rollback plan, maintenance window and an explicit reviewed exception.
- Production RDS should retain at least seven days of automated backups and have deletion protection. Confirm alternate backup coverage and recovery objectives with its owner. Changing backup retention between zero and nonzero can cause an outage.
- Internet ingress to administrative or database ports requires review, including IPv6. Public HTTPS alone is permitted in the authored benchmark. Routes, network ACLs and the service determine actual reachability.
- Broad IAM Allow actions, unscoped sensitive permissions and wildcard trust principals require review. Deny wildcards do not grant permissions. Some read/list actions require Resource `*`; this reviewer recognizes a small explicit allowlist, not the entire AWS authorization reference.
- Disabling bucket public-access protections or adding public ACL/policy grants is a risk signal. Organization/account controls and Object Ownership may override the resource configuration.
- An absent explicit S3 encryption resource does not establish unencrypted uploads. Customer-managed key requirements need separate confirmation.
- Unknown, redacted, absent, malformed or conflicting control evidence requires verification. A plan is neither a runtime reachability test nor proof of an approved exception, backup restore or compliance outcome.

The evidence corpus stores stable IDs, scope, authored summaries, source URLs and curation dates. Project-policy URLs point to this source file in the repository; the new file is local until the owner separately commits/pushes it. Official AWS pages were opened during curation. Curation dates are not claims about AWS publication dates.
