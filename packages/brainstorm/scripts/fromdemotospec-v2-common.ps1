function Get-FromDemoToSpecV2Fields {
    $definitions = Read-Utf8Json -Path (Join-Path $script:BrainstormAdapterProjectRoot 'adapters\fromdemotospec-handoff\fields-v2.json')
    foreach ($definition in $definitions) { Write-Output $definition }
}
function Get-FromDemoToSpecGapV2Validation {
    param($Gap, $Context, $BriefValidation, [string]$GapPath)
    $adapter = Get-AdapterDefinition -AdapterId 'fromdemotospec-handoff'
    foreach ($name in @('schema_version','adapter_id','session_id','source_brief','external_contract','status','structural_review','semantic_review','reviewer','decision_ids','external_flow_started','fields','tunable_parameters')) {
        Assert-AdapterContract ($Gap.PSObject.Properties.Name -contains $name) "V2 gap missing property: $name"
    }
    Assert-AdapterContract ([int]$Gap.schema_version -eq 2 -and [string]$Gap.adapter_id -eq 'fromdemotospec-handoff') 'Invalid v2 identity'
    Assert-AdapterContract ([string]$Gap.session_id -ceq [string]$Context.state.session_id) 'V2 session mismatch'
    Assert-AdapterContract ([string]$Gap.source_brief -ceq 'game-concept-brief.md') 'V2 brief mismatch'
    foreach ($name in @('path','version','last_verified_against')) {
        Assert-AdapterContract ([string]$Gap.external_contract.$name -ceq [string]$adapter.external_contract.$name) "V2 external contract drift: $name"
    }
    Assert-AdapterContract (@('gap-review','ready') -ccontains [string]$Gap.status) 'Invalid v2 gap status'
    Assert-AdapterContract ([string]$Gap.structural_review -ceq 'passed') 'V2 structural review required'
    Assert-AdapterContract (@('required','passed','failed') -ccontains [string]$Gap.semantic_review) 'Invalid v2 semantic review'
    Assert-AdapterContract ($Gap.external_flow_started -is [bool] -and $Gap.external_flow_started -eq $false) 'V2 must not launch FromDemoToSpec'
    if ([string]$Context.state.status -cne 'closed') {
        Assert-AdapterContract ($null -ne $Gap.source_snapshot) 'Active gap requires a source snapshot; rebuild the mapping for current sources.'
        $currentSnapshot = Get-HandoffSourceSnapshot -SessionDirectory $Context.session_directory
        foreach ($key in @('brief_sha256','combinations_sha256','decision_ledger_sha256')) {
            Assert-AdapterContract ([string]$Gap.source_snapshot.$key -ceq [string]$currentSnapshot.$key) "Handoff source changed; re-review the mapping before ready: $key"
        }
    }
    $definitions = Get-FromDemoToSpecV2Fields
    Assert-AdapterContract (@($Gap.fields).Count -eq $definitions.Count) 'V2 field count mismatch'
    $seen = @{}
    foreach ($field in @($Gap.fields)) {
        foreach ($name in @('field_id','fromdemotospec_target','coverage','mapped_content','source_ids','gap_or_question','blocking','next_action')) {
            Assert-AdapterContract ($field.PSObject.Properties.Name -contains $name) "V2 field missing property: $name"
        }
        $id = [string]$field.field_id
        $definition = @($definitions | Where-Object { [string]$_.field_id -ceq $id })
        Assert-AdapterContract ($definition.Count -eq 1 -and -not $seen.ContainsKey($id)) "Unknown or duplicate v2 field: $id"
        Assert-AdapterContract ([string]$field.fromdemotospec_target -ceq [string]$definition[0].fromdemotospec_target) "V2 target mismatch: $id"
        Assert-AdapterContract (@('satisfied','partial','missing','assumed','fromdemotospec-question') -ccontains [string]$field.coverage) "V2 coverage invalid: $id"
        Assert-AdapterContract ($field.blocking -is [bool]) "V2 blocking must be boolean: $id"
        Assert-AdapterSourceIds -SourceIds @($field.source_ids) -AllIds $Context.all_ids -Label $id
        if (@('satisfied','partial') -ccontains [string]$field.coverage) {
            Assert-AdapterContract (@($field.mapped_content).Count -gt 0 -and @($field.source_ids).Count -gt 0) "V2 mapped fact needs content and source: $id"
        }
        if ([string]$field.coverage -ceq 'assumed') {
            Assert-AdapterContract (@($field.mapped_content).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$field.gap_or_question)) "V2 assumption needs content and rationale: $id"
        }
        if ([string]$field.coverage -cne 'satisfied') {
            Assert-AdapterContract (-not [string]::IsNullOrWhiteSpace([string]$field.gap_or_question) -and -not [string]::IsNullOrWhiteSpace([string]$field.next_action)) "V2 unresolved field needs rationale and next action: $id"
        }
        if ([string]$Gap.status -ceq 'ready') {
            Assert-AdapterContract (-not [bool]$field.blocking) "V2 blocking field prevents handoff: $id"
            if ([bool]$definition[0].required_at_handoff) {
                Assert-AdapterContract ([string]$field.coverage -ceq 'satisfied') "V2 core input must be grounded before handoff: $id"
            }
        }
        $seen[$id] = $true
    }
    $parameterIds = @{}
    foreach ($p in @($Gap.tunable_parameters)) {
        foreach ($name in @('parameter_id','name','default','range','source_ids')) {
            Assert-AdapterContract ($p.PSObject.Properties.Name -contains $name) "V2 parameter missing $name"
        }
        Assert-AdapterContract ([string]$p.parameter_id -cmatch '^FromDemoToSpec-PARAM-[0-9]{3,}$' -and -not $parameterIds.ContainsKey([string]$p.parameter_id)) 'Invalid v2 parameter ID'
        foreach ($name in @('name','default','range')) { Assert-AdapterContract (-not [string]::IsNullOrWhiteSpace([string]$p.$name)) "Empty parameter $name" }
        Assert-AdapterContract (@($p.source_ids).Count -gt 0) 'Parameter source required'
        Assert-AdapterSourceIds -SourceIds @($p.source_ids) -AllIds $Context.all_ids -Label ([string]$p.parameter_id)
        $parameterIds[[string]$p.parameter_id] = $true
    }
    foreach ($id in @($Gap.decision_ids)) {
        Assert-AdapterContract ($Context.decision_ids.ContainsKey([string]$id)) "Unknown readiness decision: $id"
        if ([string]$Gap.status -ceq 'ready') {
            Assert-AdapterContract (@('user','joint') -ccontains [string]$Context.decision_ids[[string]$id].cells[5]) 'Product handoff intent requires a user or joint decision'
        }
    }
    if ([string]$Gap.status -ceq 'ready') {
        Assert-AdapterContract ([string]$BriefValidation.brief_status -ceq 'accepted' -and [string]$BriefValidation.fromdemotospec_intent -ceq 'requested') 'V2 requires accepted concept and requested FromDemoToSpec intent'
        Assert-AdapterContract ([string]$Gap.semantic_review -ceq 'passed' -and @('agent','user','joint') -ccontains [string]$Gap.reviewer) 'V2 mapping needs semantic review'
        Assert-AdapterContract (@($Gap.decision_ids).Count -gt 0) 'V2 user product decision reference required'
    }
    return [pscustomobject][ordered]@{
        structure_passed = $true; adapter_id = 'fromdemotospec-handoff'; session_id = [string]$Context.state.session_id
        gap_status = [string]$Gap.status; semantic_review = [string]$Gap.semantic_review
        gap_count = @($Gap.fields | Where-Object { [string]$_.coverage -cne 'satisfied' }).Count
        tunable_parameter_count = @($Gap.tunable_parameters).Count
        external_flow_started = $false; gap = $Gap; context = $Context
        brief_validation = $BriefValidation; gap_path = $GapPath
    }
}
