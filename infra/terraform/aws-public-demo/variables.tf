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

variable "vpc_cidr" {
  description = "CIDR block for the isolated demo VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "db_name" {
  description = "PostgreSQL database name."
  type        = string
  default     = "terragate"
}

variable "db_username" {
  description = "PostgreSQL admin username."
  type        = string
  default     = "terragate_admin"
}

variable "db_instance_class" {
  description = "Small RDS instance class for the demo."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated RDS storage in GiB."
  type        = number
  default     = 20
}

variable "db_backup_retention_period" {
  description = "RDS backup retention period in days. Keep 0 for the cheapest demo path."
  type        = number
  default     = 0
}

variable "db_deletion_protection" {
  description = "Enable RDS deletion protection. Disabled by default for disposable demo infra."
  type        = bool
  default     = false
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
