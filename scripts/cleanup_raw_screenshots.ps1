$ErrorActionPreference = "Stop"

$root = (Resolve-Path ".").Path
$targets = @("SCARH", "Vector")

$before = @()
foreach ($t in $targets) {
  $base = Join-Path $root $t
  $sn = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "Snipaste_*.png").Count
  $df = (Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $_.Name -like "Delta Force Screenshot*.png" }).Count
  $before += [PSCustomObject]@{
    weapon = $t
    snipaste = $sn
    delta = $df
  }

  Get-ChildItem -LiteralPath $base -Recurse -File -Filter "Snipaste_*.png" | Remove-Item -Force
  Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $_.Name -like "Delta Force Screenshot*.png" } | Remove-Item -Force
}

$after = @()
foreach ($t in $targets) {
  $base = Join-Path $root $t
  $sn = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "Snipaste_*.png").Count
  $df = (Get-ChildItem -LiteralPath $base -Recurse -File | Where-Object { $_.Name -like "Delta Force Screenshot*.png" }).Count
  $a = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "*_A.png").Count
  $b = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "*_B.png").Count
  $c = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "*_C.png").Count
  $d = (Get-ChildItem -LiteralPath $base -Recurse -File -Filter "*_D.png").Count

  $after += [PSCustomObject]@{
    weapon = $t
    snipaste_left = $sn
    delta_left = $df
    A = $a
    B = $b
    C = $c
    D = $d
  }
}

Write-Output "BEFORE"
$before | Format-Table -AutoSize | Out-String | Write-Output
Write-Output "AFTER"
$after | Format-Table -AutoSize | Out-String | Write-Output
