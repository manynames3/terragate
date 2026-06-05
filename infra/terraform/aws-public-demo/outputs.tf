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
