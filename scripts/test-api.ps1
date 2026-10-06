param(
  [string]$BaseUrl = "http://localhost:8787/api"
)

$ErrorActionPreference = "Stop"
$createdId = $null
$adjacentId = $null

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body = ""
  )

  $arguments = @("-sS", "-X", $Method, "-w", "`n%{http_code}")
  $bodyFile = $null
  if ($Body) {
    $bodyFile = [System.IO.Path]::GetTempFileName()
    Set-Content -LiteralPath $bodyFile -Value $Body -Encoding ascii -NoNewline
    $arguments += @("-H", "Content-Type: application/json", "--data-binary", "@$bodyFile")
  }
  $arguments += "$BaseUrl$Path"
  try {
    $response = (& curl.exe @arguments) -join "`n"
    if ($LASTEXITCODE -ne 0) {
      throw "curl failed for $Method $Path"
    }

    $lastNewline = $response.LastIndexOf("`n")
    if ($lastNewline -lt 0) {
      throw "Could not read HTTP status from curl response for $Method $Path"
    }
    return @{
      Status = [int]$response.Substring($lastNewline + 1)
      Body = $response.Substring(0, $lastNewline)
    }
  }
  finally {
    if ($bodyFile -and (Test-Path -LiteralPath $bodyFile)) {
      Remove-Item -LiteralPath $bodyFile
    }
  }
}

function Assert-Status {
  param($Response, [int]$Expected, [string]$Case)
  if ($Response.Status -ne $Expected) {
    throw "$Case failed: expected HTTP $Expected, got $($Response.Status): $($Response.Body)"
  }
  Write-Output "$Case`: HTTP $($Response.Status) $($Response.Body)"
}

try {
  $equipment = Invoke-Api -Method GET -Path "/equipment"
  Assert-Status $equipment 200 "List equipment"
  $equipmentRows = $equipment.Body | ConvertFrom-Json
  if (@($equipmentRows).Count -lt 2) {
    throw "Expected at least two seeded equipment records"
  }

  $payload = @{
    equipmentId = "eq-1"
    borrowerName = "API Test"
    startAt = "2026-10-20T09:00:00.000Z"
    endAt = "2026-10-20T11:00:00.000Z"
    purpose = "Automated API test"
  } | ConvertTo-Json -Compress

  $created = Invoke-Api -Method POST -Path "/bookings" -Body $payload
  Assert-Status $created 201 "Create booking"
  $createdId = ($created.Body | ConvertFrom-Json).id
  if (-not $createdId) {
    throw "Create response did not include a booking ID"
  }

  $bookingList = Invoke-Api -Method GET -Path "/bookings"
  Assert-Status $bookingList 200 "List bookings"
  if ($bookingList.Body -notmatch [regex]::Escape($createdId)) {
    throw "List bookings did not include the newly created booking"
  }

  $adjacentPayload = @{
    equipmentId = "eq-1"
    borrowerName = "Adjacent Test"
    startAt = "2026-10-20T11:00:00.000Z"
    endAt = "2026-10-20T12:00:00.000Z"
    purpose = "Adjacent interval test"
  } | ConvertTo-Json -Compress
  $adjacent = Invoke-Api -Method POST -Path "/bookings" -Body $adjacentPayload
  Assert-Status $adjacent 201 "Allow adjacent booking"
  $adjacentId = ($adjacent.Body | ConvertFrom-Json).id

  $read = Invoke-Api -Method GET -Path "/bookings/$createdId"
  Assert-Status $read 200 "Read booking"

  $unchangedInterval = Invoke-Api -Method PATCH -Path "/bookings/$createdId" -Body '{"startAt":"2026-10-20T09:00:00.000Z"}'
  Assert-Status $unchangedInterval 200 "Allow update without conflicting with itself"

  $overlapPayload = @{
    equipmentId = "eq-1"
    borrowerName = "Conflict Test"
    startAt = "2026-10-20T10:00:00.000Z"
    endAt = "2026-10-20T12:00:00.000Z"
    purpose = "Overlapping test"
  } | ConvertTo-Json -Compress
  $conflict = Invoke-Api -Method POST -Path "/bookings" -Body $overlapPayload
  Assert-Status $conflict 409 "Reject overlapping booking"

  $updateConflict = Invoke-Api -Method PATCH -Path "/bookings/$adjacentId" -Body '{"startAt":"2026-10-20T10:00:00.000Z"}'
  Assert-Status $updateConflict 409 "Reject overlapping update"

  $invalidPayload = @{
    equipmentId = "eq-1"
    borrowerName = "Invalid Test"
    startAt = "2026-10-21T12:00:00.000Z"
    endAt = "2026-10-21T11:00:00.000Z"
    purpose = "Invalid time order"
  } | ConvertTo-Json -Compress
  $invalid = Invoke-Api -Method POST -Path "/bookings" -Body $invalidPayload
  Assert-Status $invalid 400 "Reject end before start"

  $unknownEquipmentPayload = @{
    equipmentId = "eq-missing"
    borrowerName = "Invalid Equipment Test"
    startAt = "2026-10-22T09:00:00.000Z"
    endAt = "2026-10-22T10:00:00.000Z"
    purpose = "Unknown equipment test"
  } | ConvertTo-Json -Compress
  $unknownEquipment = Invoke-Api -Method POST -Path "/bookings" -Body $unknownEquipmentPayload
  Assert-Status $unknownEquipment 400 "Reject unknown equipment"

  $malformedJson = Invoke-Api -Method POST -Path "/bookings" -Body '{"equipmentId":'
  Assert-Status $malformedJson 400 "Reject malformed JSON"

  $updated = Invoke-Api -Method PATCH -Path "/bookings/$createdId" -Body '{"purpose":"Updated API test"}'
  Assert-Status $updated 200 "Update booking"

  $deleted = Invoke-Api -Method DELETE -Path "/bookings/$createdId"
  Assert-Status $deleted 204 "Delete booking"
  $createdId = $null
  $deletedAdjacent = Invoke-Api -Method DELETE -Path "/bookings/$adjacentId"
  Assert-Status $deletedAdjacent 204 "Delete adjacent booking"
  $adjacentId = $null

  $missing = Invoke-Api -Method GET -Path "/bookings/does-not-exist"
  Assert-Status $missing 404 "Return not found"

  $missingUpdate = Invoke-Api -Method PATCH -Path "/bookings/does-not-exist" -Body '{"purpose":"Should not exist"}'
  Assert-Status $missingUpdate 404 "Return not found when updating"
}
finally {
  if ($createdId) {
    Invoke-Api -Method DELETE -Path "/bookings/$createdId" | Out-Null
  }
  if ($adjacentId) {
    Invoke-Api -Method DELETE -Path "/bookings/$adjacentId" | Out-Null
  }
}
