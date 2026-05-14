package terragate.terraform.governance

required_tags := {"owner", "environment", "service", "cost_center"}

deny[msg] {
  missing := required_tags - {tag | input.tags[tag]}
  count(missing) > 0
  msg := sprintf("Missing required tags: %v", [missing])
}
