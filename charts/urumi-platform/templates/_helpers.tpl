{{- define "urumi.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "urumi.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: urumi-gate
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "urumi.secret" -}}
{{- .Values.credentials.existingSecret -}}
{{- end -}}
