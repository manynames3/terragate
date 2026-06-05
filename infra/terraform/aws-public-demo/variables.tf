variable "aws_region" {
  description = "AWS region for the public demo backend."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project name used in AWS resource names."
  type        = string
  default     = "terragate"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "demo"
}

variable "github_repo_url" {
  description = "Public Git repository cloned by CodeBuild to build the Lambda image."
  type        = string
  default     = "https://github.com/manynames3/terragate.git"
}

variable "git_ref" {
  description = "Git branch or tag cloned by CodeBuild."
  type        = string
  default     = "main"
}

variable "source_revision" {
  description = "Commit SHA or revision marker used to trigger a new CodeBuild image build."
  type        = string
  default     = "main"
}

variable "image_tag" {
  description = "Container image tag pushed to ECR."
  type        = string
  default     = "public-demo"
}

variable "database_url" {
  description = "External PostgreSQL connection string used by the Lambda API, for example a Neon direct connection string."
  type        = string
  sensitive   = true

  validation {
    condition     = startswith(var.database_url, "postgresql://") || startswith(var.database_url, "postgresql+psycopg://")
    error_message = "database_url must be a PostgreSQL connection string."
  }
}

variable "lambda_memory_size" {
  description = "Lambda memory size in MB."
  type        = number
  default     = 1024
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 60
}

variable "cors_origins" {
  description = "Allowed browser origins for the API."
  type        = list(string)
  default = [
    "http://localhost:3000",
    "http://localhost:3010"
  ]
}

variable "public_demo_allow_uploads" {
  description = "Allow small Terraform plan uploads in public demo mode."
  type        = bool
  default     = true
}

variable "public_demo_max_upload_bytes" {
  description = "Maximum upload size for public demo mode."
  type        = number
  default     = 1500000
}

variable "extra_environment" {
  description = "Additional Lambda environment variables. Do not put long-lived secrets here unless you accept Terraform state exposure."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "tags" {
  description = "Extra AWS tags."
  type        = map(string)
  default     = {}
}
