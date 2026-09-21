param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$taskDirectory = [IO.Path]::GetFullPath($job.directory).TrimEnd('\') + '\'
foreach ($entry in $job.entries) {
    if (-not [IO.Path]::GetFullPath($entry.copy).StartsWith($taskDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Calculation copy escapes task directory' }
}
if (-not [IO.Path]::GetFullPath($job.output).StartsWith($taskDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Calculation output escapes task directory' }
$excel = $null
$opened = @()
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 3
    $excel.AskToUpdateLinks = $false
    foreach ($entry in $job.entries) {
        $book = $excel.Workbooks.Open($entry.copy, 0, $false)
        $opened += $book
        if ($book.ReadOnly) { throw 'Calculation copy is read only' }
    }
    foreach ($book in $opened) {
        foreach ($link in @($book.LinkSources(1))) {
            if (-not $link) { continue }
            $matches = @($job.entries | Where-Object { [IO.Path]::GetFileName($_.original) -eq [IO.Path]::GetFileName($link) })
            if ($matches.Count -ne 1) { throw "Undeclared workbook input: $link" }
            $book.ChangeLink($link, $matches[0].copy, 1)
        }
        if ($book.LinkSources(2)) { throw 'DDE/OLE links are not supported in configuration workbooks' }
    }
    $excel.CalculateFullRebuild()
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ($excel.CalculationState -ne 0) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Formula calculation timed out' }
        Start-Sleep -Milliseconds 100
    }
    $targetBook = $opened | Where-Object { $_.FullName -eq $job.target }
    if (-not $targetBook) { throw 'Calculation target was not opened' }
    $values = @{}
    foreach ($sheet in $targetBook.Worksheets) {
        if ($sheet.Name.StartsWith('__')) { continue }
        foreach ($cell in $sheet.UsedRange.Cells) {
            if (-not $cell.HasFormula) { continue }
            $address = $cell.Address($false, $false)
            if ($cell.Text -match '^#(REF!|VALUE!|DIV/0!|N/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)$') { throw "Formula error at $($sheet.Name)!${address}: $($cell.Text)" }
            $values["$($sheet.Name)!${address}"] = $cell.Value2
        }
    }
    @{ engine = "Microsoft Excel $($excel.Version)"; values = $values } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $job.output -Encoding UTF8
} finally {
    foreach ($book in $opened) { $book.Close($false) }
    if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
