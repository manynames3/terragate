"""Render the TerraGate AWS public-demo architecture diagram."""

from pathlib import Path
from shutil import which
from subprocess import CalledProcessError, run as run_command
from sys import stderr

from diagrams import Cluster, Diagram, Edge, Node
from diagrams.aws.compute import ECR, Lambda
from diagrams.aws.database import RDS
from diagrams.aws.devtools import Codebuild
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import APIGateway
from diagrams.aws.security import Cognito
from diagrams.generic.storage import Storage
from diagrams.onprem.ci import GithubActions
from diagrams.onprem.client import User
from diagrams.onprem.iac import Terraform
from diagrams.onprem.vcs import Github
from diagrams.saas.cdn import Cloudflare


OUTPUT_PATH = Path(__file__).with_name("architecture_aws")

GRAPH_ATTR = {
    "bgcolor": "#F8FAFC",
    "fontcolor": "#0F172A",
    "fontname": "Arial Bold",
    "fontsize": "22",
    "labeljust": "l",
    "labelloc": "t",
    "nodesep": "0.4",
    "pad": "0.35",
    "ranksep": "0.65",
    "splines": "spline",
}

NODE_ATTR = {
    "color": "#CBD5E1",
    "fillcolor": "#FFFFFF",
    "fontcolor": "#0F172A",
    "fontname": "Arial",
    "fontsize": "11",
    "margin": "0.16",
    "penwidth": "1.2",
    "style": "rounded,filled",
}

EDGE_ATTR = {
    "arrowsize": "0.75",
    "color": "#64748B",
    "fontcolor": "#475569",
    "fontname": "Arial",
    "fontsize": "9",
    "penwidth": "1.4",
}

RUNTIME_EDGE = Edge(color="#2563EB", fontcolor="#1D4ED8", penwidth="2.2")
DATA_EDGE = Edge(color="#0F766E", fontcolor="#115E59", penwidth="2.0")
OPTIONAL_EDGE = Edge(
    color="#D97706",
    fontcolor="#92400E",
    penwidth="1.5",
    style="dashed",
)
DELIVERY_EDGE = Edge(color="#15803D", fontcolor="#166534", penwidth="1.8")
CI_EDGE = Edge(color="#64748B", fontcolor="#475569", penwidth="1.5")


def render() -> None:
    dot_executable = which("dot")
    if dot_executable is None:
        raise SystemExit(
            "Graphviz is required. Install it with `brew install graphviz` "
            "or your platform package manager."
        )

    with Diagram(
        "TerraGate | AWS Public Demo Architecture",
        filename=str(OUTPUT_PATH),
        outformat=["png", "dot"],
        show=False,
        direction="LR",
        graph_attr=GRAPH_ATTR,
        node_attr=NODE_ATTR,
        edge_attr=EDGE_ATTR,
    ):
        reviewer = User("Platform reviewer")

        with Cluster(
            "Edge & frontend",
            graph_attr={
                "color": "#EFF6FF",
                "fontcolor": "#1E3A8A",
                "pencolor": "#93C5FD",
                "penwidth": "1.5",
                "style": "rounded,filled",
            },
        ):
            frontend = Cloudflare("Cloudflare Worker\nNext.js + OpenNext\nobservability enabled")

        with Cluster(
            "AWS account | Terraform-defined public demo",
            graph_attr={
                "color": "#FFF7ED",
                "fontcolor": "#9A3412",
                "pencolor": "#FB923C",
                "penwidth": "1.8",
                "style": "rounded,filled",
            },
        ):
            api_gateway = APIGateway("HTTP API\npublic + CORS")

            with Cluster(
                "VPC | 2 private subnets | no NAT gateway",
                graph_attr={
                    "color": "#FFFBEB",
                    "fontcolor": "#92400E",
                    "pencolor": "#F59E0B",
                    "penwidth": "1.5",
                    "style": "rounded,filled",
                },
            ):
                backend = Lambda("FastAPI + Mangum\nLangGraph review\ninline execution")
                artifacts = Storage("/tmp artifacts\nephemeral")
                database = RDS("RDS PostgreSQL\nprivate + encrypted")

            cloudwatch = Cloudwatch("CloudWatch Logs\n14-day retention")

            with Cluster(
                "Image build & registry",
                graph_attr={
                    "color": "#F8FAFC",
                    "fontcolor": "#475569",
                    "pencolor": "#CBD5E1",
                    "penwidth": "1.2",
                    "style": "rounded,filled",
                },
            ):
                codebuild = Codebuild("CodeBuild\ncontainer build")
                registry = ECR("ECR\nscan on push")

        with Cluster(
            "Optional integrations | disabled in public demo",
            graph_attr={
                "color": "#FFFBEB",
                "fontcolor": "#92400E",
                "pencolor": "#FBBF24",
                "penwidth": "1.4",
                "style": "rounded,dashed,filled",
            },
        ):
            cognito = Cognito("Cognito auth\noptional; not provisioned")
            openai = Node(
                "OpenAI API\nredacted evidence only",
                shape="box",
                style="rounded,filled",
                fillcolor="#FFFFFF",
                color="#F59E0B",
                fontcolor="#78350F",
                fontname="Arial",
                fontsize="11",
                margin="0.18",
            )
            github_api = Github("GitHub API\napproval-gated writes")

        reviewer >> Edge(label="HTTPS UI", **RUNTIME_EDGE.attrs) >> frontend
        reviewer >> Edge(label="HTTPS JSON", **RUNTIME_EDGE.attrs) >> api_gateway
        api_gateway >> Edge(label="AWS_PROXY", **RUNTIME_EDGE.attrs) >> backend
        backend >> Edge(label="local artifacts", **DATA_EDGE.attrs) >> artifacts
        backend >> Edge(label="TCP 5432\nLambda SG only", **DATA_EDGE.attrs) >> database
        backend >> Edge(label="application logs", **DATA_EDGE.attrs) >> cloudwatch

        reviewer >> Edge(label="optional PKCE", **OPTIONAL_EDGE.attrs) >> cognito
        cognito >> Edge(label="JWT", **OPTIONAL_EDGE.attrs) >> api_gateway
        backend >> Edge(label="optional AI", **OPTIONAL_EDGE.attrs) >> openai
        backend >> Edge(label="mocked writes", **OPTIONAL_EDGE.attrs) >> github_api
        github_api >> Edge(label="optional webhook", **OPTIONAL_EDGE.attrs) >> api_gateway

        with Cluster(
            "Source, CI & deployment triggers",
            graph_attr={
                "color": "#F0FDF4",
                "fontcolor": "#166534",
                "pencolor": "#86EFAC",
                "penwidth": "1.5",
                "style": "rounded,filled",
            },
        ):
            source = Github("GitHub source")
            actions = GithubActions("GitHub Actions\nCI only")
            terraform = Terraform("Terraform apply")

        source >> Edge(label="push / PR", **CI_EDGE.attrs) >> actions
        terraform >> Edge(label="start build", **DELIVERY_EDGE.attrs) >> codebuild
        source >> Edge(label="clone ref", **DELIVERY_EDGE.attrs) >> codebuild
        codebuild >> DELIVERY_EDGE >> registry
        registry >> Edge(label="image digest", **DELIVERY_EDGE.attrs) >> backend
        source >> Edge(label="manual OpenNext + Wrangler deploy", **DELIVERY_EDGE.attrs) >> frontend
        codebuild >> Edge(label="build logs", **CI_EDGE.attrs) >> cloudwatch

    dot_path = OUTPUT_PATH.with_suffix(".dot")
    svg_path = OUTPUT_PATH.with_suffix(".svg")
    try:
        run_command(
            [dot_executable, "-Tsvg:cairo:cairo", str(dot_path), "-o", str(svg_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except CalledProcessError as exc:
        svg_path.unlink(missing_ok=True)
        print(
            "PNG rendered; SVG skipped because this Graphviz installation does not "
            f"provide the Cairo SVG renderer: {exc.stderr.strip()}",
            file=stderr,
        )
    finally:
        dot_path.unlink(missing_ok=True)


if __name__ == "__main__":
    render()
