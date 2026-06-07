$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path ".").Path
$targets = @("SCARH", "Vector")

function Remove-LeadingJ([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return $name }
  if ($name.StartsWith("J")) { return $name.Substring(1) }
  return $name
}

function Get-ImageStats([string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($path)
  try {
    $sampleW = [Math]::Max([int]($bmp.Width / 60), 1)
    $sampleH = [Math]::Max([int]($bmp.Height / 60), 1)
    $blueScore = 0.0
    $luma = 0.0
    $count = 0

    for ($y = 0; $y -lt $bmp.Height; $y += $sampleH) {
      for ($x = 0; $x -lt $bmp.Width; $x += $sampleW) {
        $c = $bmp.GetPixel($x, $y)
        $r = [double]$c.R
        $g = [double]$c.G
        $b = [double]$c.B
        $l = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b
        $blueScore += ($b - ($r + $g) / 2.0)
        $luma += $l
        $count++
      }
    }
    if ($count -eq 0) { $count = 1 }
    return @{
      blue = $blueScore / $count
      luma = $luma / $count
    }
  } finally {
    $bmp.Dispose()
  }
}

function Save-Cropped([string]$src, [string]$dest, [double]$leftPct, [double]$topPct, [double]$rightPct, [double]$bottomPct) {
  $bmp = New-Object System.Drawing.Bitmap($src)
  try {
    $w = $bmp.Width
    $h = $bmp.Height
    $left = [int][Math]::Round($w * $leftPct)
    $top = [int][Math]::Round($h * $topPct)
    $right = [int][Math]::Round($w * $rightPct)
    $bottom = [int][Math]::Round($h * $bottomPct)
    $cropW = $w - $left - $right
    $cropH = $h - $top - $bottom
    if ($cropW -lt 1 -or $cropH -lt 1) {
      throw "Invalid crop size for $src"
    }
    $rect = New-Object System.Drawing.Rectangle($left, $top, $cropW, $cropH)
    $cropped = $bmp.Clone($rect, $bmp.PixelFormat)
    try {
      $cropped.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $cropped.Dispose()
    }
  } finally {
    $bmp.Dispose()
  }
}

function Copy-Png([string]$src, [string]$dest) {
  Copy-Item -LiteralPath $src -Destination $dest -Force
}

$allRecords = @()
$allMeta = @()

foreach ($weapon in $targets) {
  $weaponDir = Join-Path $root $weapon
  if (!(Test-Path -LiteralPath $weaponDir)) {
    throw "Missing weapon dir: $weaponDir"
  }

  $folders = Get-ChildItem -LiteralPath $weaponDir -Directory | Sort-Object Name
  foreach ($folder in $folders) {
    $templateRaw = $folder.Name
    $template = Remove-LeadingJ $templateRaw
    $serial = "001"
    $id = "$weapon-$template-$serial"
    $pngs = Get-ChildItem -LiteralPath $folder.FullName -File -Filter "*.png" | Sort-Object Name
    $snip = $pngs | Where-Object { $_.Name -like "Snipaste_*.png" } | Select-Object -First 1
    $delta = $pngs | Where-Object { $_.Name -like "Delta Force Screenshot*.png" } | Sort-Object Name
    $status = "ready"

    if (-not $snip -or $delta.Count -lt 3) {
      $status = "incomplete"
    }

    $newA = Join-Path $folder.FullName "${id}_A.png"
    $newB = Join-Path $folder.FullName "${id}_B.png"
    $newC = Join-Path $folder.FullName "${id}_C.png"
    $newD = Join-Path $folder.FullName "${id}_D.png"

    if ($status -eq "ready") {
      Copy-Png $snip.FullName $newA

      $deltas = @($delta | Select-Object -First 3)
      $stats = @()
      foreach ($d in $deltas) {
        $s = Get-ImageStats $d.FullName
        $stats += [PSCustomObject]@{
          file = $d
          blue = [double]$s.blue
          luma = [double]$s.luma
          score = [double]$s.blue + ([double]$s.luma * 0.08)
        }
      }
      $sorted = $stats | Sort-Object score -Descending
      $dCandidate = $sorted[0]
      $margin = $sorted[0].score - $sorted[1].score
      $useContentForD = $margin -ge 6.0

      if ($useContentForD) {
        $dFile = $dCandidate.file
        $remaining = $deltas | Where-Object { $_.FullName -ne $dFile.FullName } | Sort-Object Name
        $bFile = $remaining[0]
        $cFile = $remaining[1]
      } else {
        $bFile = $deltas[0]
        $cFile = $deltas[1]
        $dFile = $deltas[2]
      }

      Save-Cropped $bFile.FullName $newB 0.15 0.10 0.06 0.18
      Save-Cropped $cFile.FullName $newC 0.0 0.022 0.0 0.0
      Save-Cropped $dFile.FullName $newD 0.0 0.022 0.0 0.0
    }

    $record = [PSCustomObject]@{
      id = $id
      folderCode = $folder.Name
      normalizedCode = "J"
      weapon = $weapon
      serial = $serial
      imageA = "../$weapon/$($folder.Name)/$(${id})_A.png"
      imageB = "../$weapon/$($folder.Name)/$(${id})_B.png"
      imageC = "../$weapon/$($folder.Name)/$(${id})_C.png"
      imageD = "../$weapon/$($folder.Name)/$(${id})_D.png"
      status = $status
      template = $template
      qualityLabel = "J"
      materialLabel = "NA"
      colorLabel = "NA"
    }
    $allRecords += $record

    $meta = [PSCustomObject]@{
      id = $id
      name = $template
      rating = ""
      comment = ""
    }
    $allMeta += $meta
  }
}

$recordsOut = Join-Path $root "site\_new_weapon_records.json"
$metaOut = Join-Path $root "site\_new_weapon_meta.json"
$allRecords | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordsOut -Encoding UTF8
$allMeta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metaOut -Encoding UTF8

Write-Output "Generated: $recordsOut"
Write-Output "Generated: $metaOut"
