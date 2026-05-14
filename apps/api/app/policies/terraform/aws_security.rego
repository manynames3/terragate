package terragate.terraform.aws_security

# Placeholder for future OPA execution. The v1 app runs equivalent deterministic
# Python checks so the demo works without an OPA sidecar.

deny[msg] {
  input.resource_type == "aws_security_group"
  msg := "Security group ingress must not expose sensitive ports to the internet"
}
