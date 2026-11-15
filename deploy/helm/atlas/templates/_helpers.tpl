{{/* Chart name, overridable. */}}
{{- define "atlas.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Full name for the release's objects. A release whose name already contains the
chart name (the usual `helm install atlas ...`) is not doubled to atlas-atlas.
*/}}
{{- define "atlas.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "atlas.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* The labels a selector matches on. Never change these on a live release. */}}
{{- define "atlas.selectorLabels" -}}
app.kubernetes.io/name: {{ include "atlas.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "atlas.labels" -}}
helm.sh/chart: {{ include "atlas.chart" . }}
{{ include "atlas.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "atlas.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "atlas.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The image reference: [registry/]repository then @digest or :tag. A digest wins
over a tag, so a tag moved in the registry cannot change what runs.
*/}}
{{- define "atlas.image" -}}
{{- $repository := .Values.image.repository }}
{{- with .Values.image.registry }}
{{- $repository = printf "%s/%s" (trimSuffix "/" .) $repository }}
{{- end }}
{{- if .Values.image.digest }}
{{- printf "%s@%s" $repository .Values.image.digest }}
{{- else }}
{{- printf "%s:%s" $repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}
{{- end }}
