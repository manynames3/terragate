output "api_base_url" {
  description = "Public API Gateway base URL for NEXT_PUBLIC_API_BASE_URL."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "lambda_function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.api.function_name
}

output "ecr_repository_url" {
  description = "ECR repository used for the Lambda image."
  value       = aws_ecr_repository.api.repository_url
}

output "rds_instance_id" {
  description = "RDS PostgreSQL instance identifier."
  value       = aws_db_instance.postgres.identifier
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint."
  value       = aws_db_instance.postgres.endpoint
}

output "database_url" {
  description = "Database URL stored on the Lambda function."
  value       = "postgresql+psycopg://${var.db_username}:${urlencode(random_password.database.result)}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
  sensitive   = true
}
