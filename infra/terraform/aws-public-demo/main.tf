data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  tags = merge(
    {
      Project     = "TerraGate"
      Environment = var.environment
      ManagedBy   = "Terraform"
      CostProfile = "public-demo"
    },
    var.tags
  )
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${local.name_prefix}-private-${count.index + 1}"
  }
}

resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda"
  description = "TerraGate Lambda egress"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Allow Lambda to reach RDS and AWS service endpoints"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-lambda"
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-postgres"
  description = "PostgreSQL access from TerraGate Lambda only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-postgres"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "random_password" "database" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  allocated_storage       = var.db_allocated_storage
  backup_retention_period = var.db_backup_retention_period
  db_name                 = var.db_name
  db_subnet_group_name    = aws_db_subnet_group.main.name
  deletion_protection     = var.db_deletion_protection
  engine                  = "postgres"
  instance_class          = var.db_instance_class
  password                = random_password.database.result
  publicly_accessible     = false
  skip_final_snapshot     = true
  storage_encrypted       = true
  storage_type            = "gp3"
  username                = var.db_username
  vpc_security_group_ids  = [aws_security_group.database.id]

  apply_immediately = true
}

resource "aws_ecr_repository" "api" {
  name         = "${local.name_prefix}-api"
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/aws/codebuild/${local.name_prefix}-lambda-image"
  retention_in_days = 14
}

resource "aws_iam_role" "codebuild" {
  name = "${local.name_prefix}-codebuild"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "codebuild.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "codebuild" {
  name = "${local.name_prefix}-codebuild"
  role = aws_iam_role.codebuild.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          aws_cloudwatch_log_group.codebuild.arn,
          "${aws_cloudwatch_log_group.codebuild.arn}:*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = aws_ecr_repository.api.arn
      }
    ]
  })
}

resource "aws_codebuild_project" "lambda_image" {
  name         = "${local.name_prefix}-lambda-image"
  description  = "Builds and pushes the TerraGate Lambda container image."
  service_role = aws_iam_role.codebuild.arn

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    privileged_mode = true
    type            = "LINUX_CONTAINER"

    environment_variable {
      name  = "ECR_REPOSITORY_URI"
      value = aws_ecr_repository.api.repository_url
    }

    environment_variable {
      name  = "IMAGE_TAG"
      value = var.image_tag
    }

    environment_variable {
      name  = "REPO_URL"
      value = var.github_repo_url
    }

    environment_variable {
      name  = "GIT_REF"
      value = var.git_ref
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild.name
      status     = "ENABLED"
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = <<-YAML
      version: 0.2
      phases:
        pre_build:
          commands:
            - echo "Cloning $REPO_URL at $GIT_REF"
            - git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" source
            - cd source
            - aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$${ECR_REPOSITORY_URI%/*}"
        build:
          commands:
            - docker build --platform linux/amd64 -f infra/Dockerfile.lambda -t "$ECR_REPOSITORY_URI:$IMAGE_TAG" .
        post_build:
          commands:
            - docker push "$ECR_REPOSITORY_URI:$IMAGE_TAG"
      YAML
  }
}

resource "null_resource" "build_lambda_image" {
  triggers = {
    source_revision = var.source_revision
    image_tag       = var.image_tag
    dockerfile_hash = filesha256("${path.module}/../../Dockerfile.lambda")
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -euo pipefail

      build_id=$(aws codebuild start-build \
        --region ${var.aws_region} \
        --project-name ${aws_codebuild_project.lambda_image.name} \
        --query 'build.id' \
        --output text)

      echo "Started CodeBuild build: $build_id"

      while true; do
        status=$(aws codebuild batch-get-builds \
          --region ${var.aws_region} \
          --ids "$build_id" \
          --query 'builds[0].buildStatus' \
          --output text)
        echo "CodeBuild status: $status"
        case "$status" in
          SUCCEEDED)
            exit 0
            ;;
          FAILED|FAULT|STOPPED|TIMED_OUT)
            echo "CodeBuild image build failed with status $status" >&2
            exit 1
            ;;
          *)
            sleep 20
            ;;
        esac
      done
    EOT
  }

  depends_on = [aws_codebuild_project.lambda_image]
}

data "aws_ecr_image" "api" {
  repository_name = aws_ecr_repository.api.name
  image_tag       = var.image_tag

  depends_on = [null_resource.build_lambda_image]
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = 14
}

resource "aws_iam_role" "lambda" {
  name = "${local.name_prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.api.repository_url}@${data.aws_ecr_image.api.image_digest}"

  architectures = ["x86_64"]
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout_seconds

  vpc_config {
    security_group_ids = [aws_security_group.lambda.id]
    subnet_ids         = aws_subnet.private[*].id
  }

  environment {
    variables = merge(
      {
        APP_ENV                             = "production"
        ARTIFACT_STORAGE_DIR                = "/tmp/artifacts"
        AUTH_MODE                           = "dev"
        CORS_ORIGINS                        = join(",", var.cors_origins)
        DATABASE_URL                        = "postgresql+psycopg://${var.db_username}:${urlencode(random_password.database.result)}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
        LANGSMITH_PROJECT                   = "terragate"
        LANGSMITH_TRACING                   = "false"
        OPENAI_MODEL                        = "gpt-5.4-mini"
        PUBLIC_DEMO_ALLOW_LIVE_GITHUB_READS = "false"
        PUBLIC_DEMO_ALLOW_UPLOADS           = tostring(var.public_demo_allow_uploads)
        PUBLIC_DEMO_DISABLE_SANDBOX         = "true"
        PUBLIC_DEMO_MAX_UPLOAD_BYTES        = tostring(var.public_demo_max_upload_bytes)
        PUBLIC_DEMO_MOCK_GITHUB_WRITES      = "true"
        PUBLIC_DEMO_MODE                    = "true"
        PUBLIC_DEMO_SAMPLE_DATA_DIR         = "/var/task/sample-data/terraform-plans"
        REVIEW_EXECUTION_MODE               = "inline"
      },
      var.extra_environment
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy_attachment.lambda_vpc
  ]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["GET", "POST", "PUT", "OPTIONS"]
    allow_origins     = var.cors_origins
    max_age           = 3600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
