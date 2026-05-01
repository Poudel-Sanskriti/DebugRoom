terraform {

  required_version = ">= 1.8.0"
  required_providers {

    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }

  }

}
provider "aws" {
  region = var.aws_region
}
variable "aws_region" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "Provide an AWS region name."
  }
}
variable "name" {

  type    = string
  default = "debugroom"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.name))
    error_message = "Use a short lowercase resource prefix."
  }

}
variable "domain_name" {

  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.domain_name))
    error_message = "Provide the DNS name you control."
  }

}
variable "route53_zone_id" {
  type    = string
  default = ""
}
variable "app_image" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$", var.app_image))
    error_message = "Provide a tested private ECR image pinned by digest."
  }
}
variable "agent_image" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$", var.agent_image))
    error_message = "Provide a tested private ECR image pinned by digest."
  }
}
variable "python_image" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$", var.python_image))
    error_message = "Provide a tested private ECR image pinned by digest."
  }
}
variable "image_repository_arns" {
  type = list(string)
}
variable "github_oauth_secret_arn" {

  type        = string
  description = "Existing Secrets Manager JSON secret with clientId and clientSecret. No plaintext OAuth secret belongs in tfvars."
  validation {
    condition     = can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", var.github_oauth_secret_arn))
    error_message = "Provide a Secrets Manager secret ARN."
  }

}
variable "postgres_engine_version" {

  type        = string
  description = "An exact PostgreSQL 18 minor supported by RDS in the chosen region. Verify it before applying."
  validation {
    condition     = can(regex("^18\\.[0-9]+$", var.postgres_engine_version))
    error_message = "Select a supported PostgreSQL 18 minor."
  }

}
variable "monthly_budget_usd" {

  type = number
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "Set an explicit monthly budget before provisioning."
  }

}
variable "budget_email" {
  type    = string
  default = ""
}

locals {

  images = [var.app_image, var.agent_image, var.python_image]
  tags   = { Project = "DebugRoom", Environment = "pilot" }

}
check "pinned_images" {

  assert {

    condition     = alltrue([for image in local.images : can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$", image))])
    error_message = "Publish tested images to private ECR and provide immutable digest references."

  }

}
data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_ami" "ubuntu" {

  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

}
data "aws_caller_identity" "current" {

}
resource "random_id" "suffix" {
  byte_length = 4
}
resource "random_password" "runner" {
  length  = 48
  special = false
}
resource "aws_vpc" "main" {

  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = local.tags

}
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = local.tags
}
resource "aws_subnet" "public" {

  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = local.tags

}
resource "aws_subnet" "database" {

  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = local.tags

}
resource "aws_route_table" "public" {

  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = local.tags

}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "app" {

  name_prefix = "${var.name}-app-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags

}
resource "aws_security_group" "worker" {

  name_prefix = "${var.name}-worker-"
  vpc_id      = aws_vpc.main.id
  # No inbound listener or SSH. Administration uses SSM.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags

}
resource "aws_security_group" "database" {

  name_prefix = "${var.name}-db-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  tags = local.tags

}
resource "aws_db_subnet_group" "main" {
  name_prefix = "${var.name}-"
  subnet_ids  = aws_subnet.database[*].id
  tags        = local.tags
}
resource "aws_db_instance" "main" {

  identifier                  = "${var.name}-postgres"
  engine                      = "postgres"
  engine_version              = var.postgres_engine_version
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  max_allocated_storage       = 40
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "debugroom"
  username                    = "debugroom_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  publicly_accessible         = false
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.name}-final-${random_id.suffix.hex}"
  auto_minor_version_upgrade  = false
  tags                        = local.tags

}
resource "aws_s3_bucket" "traces" {
  bucket        = "${var.name}-traces-${random_id.suffix.hex}"
  force_destroy = false
  tags          = local.tags
}
resource "aws_s3_bucket_public_access_block" "traces" {

  bucket                  = aws_s3_bucket.traces.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

}
resource "aws_s3_bucket_versioning" "traces" {
  bucket = aws_s3_bucket.traces.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "traces" {

  bucket = aws_s3_bucket.traces.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }

}
resource "aws_s3_bucket_lifecycle_configuration" "traces" {

  bucket = aws_s3_bucket.traces.id
  rule {

    id     = "retire-backup-versions"
    status = "Enabled"
    filter {
      prefix = ""
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }

  }

}
resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.name}/app"
  retention_in_days = 30
  tags              = local.tags
}
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/${var.name}/worker"
  retention_in_days = 30
  tags              = local.tags
}
resource "aws_secretsmanager_secret" "runner" {
  name_prefix             = "${var.name}-runner-"
  recovery_window_in_days = 7
  tags                    = local.tags
}
resource "aws_secretsmanager_secret_version" "runner" {
  secret_id     = aws_secretsmanager_secret.runner.id
  secret_string = random_password.runner.result
}
resource "aws_iam_role" "host" {

  for_each           = toset(["app", "worker"])
  name_prefix        = "${var.name}-${each.key}-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })

}
resource "aws_iam_instance_profile" "host" {
  for_each    = aws_iam_role.host
  name_prefix = "${var.name}-${each.key}-"
  role        = each.value.name
}
resource "aws_iam_role_policy_attachment" "ssm" {
  for_each   = aws_iam_role.host
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "images" {

  for_each = aws_iam_role.host
  role     = each.value.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = var.image_repository_arns }
  ] })

}
resource "aws_iam_role_policy" "app_data" {

  role = aws_iam_role.host["app"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.github_oauth_secret_arn, aws_secretsmanager_secret.runner.arn, aws_db_instance.main.master_user_secret[0].secret_arn] },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.traces.arn}/*" },
    { Effect = "Allow", Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = aws_s3_bucket.traces.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "${aws_cloudwatch_log_group.app.arn}:*" }
  ] })

}
resource "aws_iam_role_policy" "worker_control" {

  role = aws_iam_role.host["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.runner.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "${aws_cloudwatch_log_group.worker.arn}:*" }
  ] })

}
resource "aws_instance" "app" {

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t4g.small"
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.host["app"].name
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = 25
    encrypted   = true
  }
  user_data = templatefile("${path.module}/app.sh.tftpl", {
    region          = var.aws_region, domain = var.domain_name, app_image = var.app_image,
    github_secret   = var.github_oauth_secret_arn, runner_secret = aws_secretsmanager_secret.runner.arn,
    database_secret = aws_db_instance.main.master_user_secret[0].secret_arn,
    database_host   = aws_db_instance.main.address, bucket = aws_s3_bucket.traces.id,
    log_group       = aws_cloudwatch_log_group.app.name
  })
  tags       = merge(local.tags, { Name = "${var.name}-app" })
  depends_on = [aws_iam_role_policy.app_data, aws_iam_role_policy.images, aws_secretsmanager_secret_version.runner]

}
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = local.tags
}
resource "aws_route53_record" "app" {

  count   = var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]

}
resource "aws_instance" "worker" {

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t4g.small"
  subnet_id              = aws_subnet.public[1].id
  vpc_security_group_ids = [aws_security_group.worker.id]
  iam_instance_profile   = aws_iam_instance_profile.host["worker"].name
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = 25
    encrypted   = true
  }
  user_data = templatefile("${path.module}/worker.sh.tftpl", {
    region       = var.aws_region, domain = var.domain_name, agent_image = var.agent_image,
    python_image = var.python_image, runner_secret = aws_secretsmanager_secret.runner.arn,
    log_group    = aws_cloudwatch_log_group.worker.name, gvisor_installer = file("${path.module}/../install-gvisor.sh")
  })
  tags       = merge(local.tags, { Name = "${var.name}-worker" })
  depends_on = [aws_iam_role_policy.worker_control, aws_iam_role_policy.images, aws_secretsmanager_secret_version.runner]

}
resource "aws_budgets_budget" "pilot" {

  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  dynamic "notification" {

    for_each = var.budget_email == "" ? [] : [var.budget_email]
    content {

      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [notification.value]

    }

  }

}
output "application_url" {
  value = "https://${var.domain_name}"
}
output "application_ip" {
  value = aws_eip.app.public_ip
}
output "application_instance" {
  value = aws_instance.app.id
}
output "worker_instance" {
  value = aws_instance.worker.id
}
output "trace_bucket" {
  value = aws_s3_bucket.traces.id
}
