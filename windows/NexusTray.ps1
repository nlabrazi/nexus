#Requires -Version 5.1
<#
.SYNOPSIS
    Nexus Windows System Tray Application
    Gere le daemon Nexus en arriere-plan, affiche l etat dans la barre des taches (systray),
    permet d ouvrir l interface Web, de copier l URL mobile et de demarrer avec Windows.
#>

[CmdletBinding()]
param(
    [switch]$DebugMode
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
}

$logFile = Join-Path $scriptDir "nexus-tray.log"

function Log-Message([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    if ($DebugMode) {
        Write-Host $line
    }
    try {
        Add-Content -Path $logFile -Value $line -Force -ErrorAction SilentlyContinue
    } catch {}
}

Log-Message "--- Lancement de NexusTray.ps1 ---"
Log-Message "Dossier : $scriptDir"

try {
    # 1. Instance unique (verrou local sans droits admin)
    $mutexName = "NexusWindowsTrayMutex"
    $createdNew = $false
    $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)

    if (-not $createdNew) {
        Log-Message "Une instance de NexusTray est deja active. Sortie."
        [System.Windows.Forms.MessageBox]::Show(
            "Nexus tourne deja dans la barre des taches (pres de l horloge Windows).`nVerifiez la zone de notification ou la fleche ^.",
            "Nexus Agent",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
        exit 0
    }

    $iconPath = Join-Path $scriptDir "nexus.ico"
    $port = 4040
    $healthUrl = "http://127.0.0.1:" + $port + "/health"

    $startupShortcutPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) "Nexus.lnk"
    $vbsLauncherPath = Join-Path $scriptDir "Nexus.vbs"

    # 2. Fonctions de controle du daemon via WSL
    function Get-DaemonHealth {
        try {
            $req = [System.Net.WebRequest]::Create($healthUrl)
            $req.Timeout = 1200
            $req.Method = "GET"
            $resp = $req.GetResponse()
            $resp.Close()
            return $true
        } catch {
            return $false
        }
    }

    function Start-NexusDaemon {
        if (Get-DaemonHealth) {
            Log-Message "Daemon deja en ligne sur $healthUrl."
            return
        }
        
        Log-Message "Demarrage du daemon Nexus via WSL..."
        $nodePath = "/home/kaox/.nvm/versions/node/v24.14.1/bin/node"
        $daemonJs = "/home/kaox/code/bricolage/nexus/dist/daemon.js"
        $wslCmd = "tmux kill-session -t nexus-daemon 2>/dev/null || true; " +
                  "tmux new-session -d -s nexus-daemon '" + $nodePath + " " + $daemonJs + " --host 0.0.0.0 --port " + $port + "'"

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "wsl.exe"
        $psi.Arguments = "-e bash -l -c `"" + $wslCmd + "`""
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false

        try {
            $proc = [System.Diagnostics.Process]::Start($psi)
            $proc.WaitForExit(3000)
            Log-Message "Commande WSL executee."
        } catch {
            Log-Message "Erreur lancement WSL : $_"
        }
    }

    function Stop-NexusDaemon {
        Log-Message "Arret du daemon Nexus..."
        $wslCmd = "tmux kill-session -t nexus-daemon 2>/dev/null || true; pkill -f 'dist/daemon.js' 2>/dev/null || true"

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "wsl.exe"
        $psi.Arguments = "-e bash -c `"" + $wslCmd + "`""
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false

        try {
            $proc = [System.Diagnostics.Process]::Start($psi)
            $proc.WaitForExit(3000)
        } catch {
            Log-Message "Erreur arret WSL : $_"
        }
    }

    function Restart-NexusDaemon {
        Stop-NexusDaemon
        Start-Sleep -Milliseconds 800
        Start-NexusDaemon
    }

    function Get-LocalIpAddress {
        try {
            $ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
                $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL" -and
                $_.IPAddress -notmatch "^127\.|^169\.254\."
            }
            $tailscale = $ips | Where-Object { $_.IPAddress -match "^100\." } | Select-Object -First 1
            if ($tailscale) { return $tailscale.IPAddress }

            $lan = $ips | Where-Object { $_.IPAddress -match "^192\.168\.|^10\.|^172\." } | Select-Object -First 1
            if ($lan) { return $lan.IPAddress }
        } catch {}
        return "127.0.0.1"
    }

    function Test-StartupShortcut {
        return (Test-Path $startupShortcutPath)
    }

    function Toggle-StartupShortcut {
        if (Test-StartupShortcut) {
            Remove-Item -Path $startupShortcutPath -Force -ErrorAction SilentlyContinue
            Log-Message "Raccourci de demarrage supprime."
            return $false
        } else {
            $wsh = New-Object -ComObject WScript.Shell
            $shortcut = $wsh.CreateShortcut($startupShortcutPath)
            $shortcut.TargetPath = $vbsLauncherPath
            $shortcut.WorkingDirectory = $scriptDir
            $shortcut.IconLocation = "$iconPath,0"
            $shortcut.Description = "Nexus Agent - Demarrage automatique"
            $shortcut.Save()
            Log-Message "Raccourci de demarrage cree : $startupShortcutPath"
            return $true
        }
    }

    # 3. NotifyIcon
    $notifyIcon = New-Object System.Windows.Forms.NotifyIcon

    if (Test-Path $iconPath) {
        try {
            $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
            Log-Message "Icone chargee avec succes."
        } catch {
            Log-Message "Impossible de charger nexus.ico : $_ . Utilisation icone systeme."
            $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
        }
    } else {
        Log-Message "nexus.ico absent. Utilisation icone systeme."
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    }

    $notifyIcon.Text = "Nexus Agent - Initialisation..."
    $notifyIcon.Visible = $true

    # 4. Menu contextuel
    $contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

    $headerItem = New-Object System.Windows.Forms.ToolStripMenuItem("Nexus Agent v1.0.0")
    $headerItem.Enabled = $false
    $font = New-Object System.Drawing.Font($headerItem.Font.FontFamily, $headerItem.Font.Size, [System.Drawing.FontStyle]::Bold)
    $headerItem.Font = $font
    [void]$contextMenu.Items.Add($headerItem)

    $statusItem = New-Object System.Windows.Forms.ToolStripMenuItem("[En ligne] Port " + $port)
    $statusItem.Enabled = $false
    [void]$contextMenu.Items.Add($statusItem)

    [void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $openWebItem = New-Object System.Windows.Forms.ToolStripMenuItem("Ouvrir l application Web")
    $openWebItem.Add_Click({
        [System.Diagnostics.Process]::Start("http://localhost:" + $port)
    })
    [void]$contextMenu.Items.Add($openWebItem)

    $copyUrlItem = New-Object System.Windows.Forms.ToolStripMenuItem("Copier l URL mobile")
    $copyUrlItem.Add_Click({
        $ip = Get-LocalIpAddress
        $url = "http://" + $ip + ":" + $port
        [System.Windows.Forms.Clipboard]::SetText($url)
        $notifyIcon.ShowBalloonTip(
            2000,
            "Nexus - URL copiee",
            "L adresse mobile " + $url + " a ete copiee.",
            [System.Windows.Forms.ToolTipIcon]::Info
        )
    })
    [void]$contextMenu.Items.Add($copyUrlItem)

    [void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $restartItem = New-Object System.Windows.Forms.ToolStripMenuItem("Redemarrer le demon")
    $restartItem.Add_Click({
        $notifyIcon.Text = "Nexus Agent - Redemarrage..."
        $statusItem.Text = "[...] Redemarrage..."
        Restart-NexusDaemon
        Start-Sleep -Seconds 1
        Update-Status
    })
    [void]$contextMenu.Items.Add($restartItem)

    $toggleDaemonItem = New-Object System.Windows.Forms.ToolStripMenuItem("Arreter le demon")
    $toggleDaemonItem.Add_Click({
        if (Get-DaemonHealth) {
            Stop-NexusDaemon
        } else {
            Start-NexusDaemon
        }
        Start-Sleep -Milliseconds 800
        Update-Status
    })
    [void]$contextMenu.Items.Add($toggleDaemonItem)

    [void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $startupItem = New-Object System.Windows.Forms.ToolStripMenuItem("Demarrer avec Windows")
    $startupItem.Checked = Test-StartupShortcut
    $startupItem.Add_Click({
        $isNowEnabled = Toggle-StartupShortcut
        $startupItem.Checked = $isNowEnabled
        if ($isNowEnabled) {
            $notifyIcon.ShowBalloonTip(2000, "Nexus", "Demarrage automatique avec Windows active.", [System.Windows.Forms.ToolTipIcon]::Info)
        } else {
            $notifyIcon.ShowBalloonTip(2000, "Nexus", "Demarrage automatique desactive.", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    })
    [void]$contextMenu.Items.Add($startupItem)

    [void]$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem("Quitter Nexus")
    $exitItem.Add_Click({
        Log-Message "Fermeture demandee par l utilisateur."
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
        Stop-NexusDaemon
        [System.Windows.Forms.Application]::Exit()
    })
    [void]$contextMenu.Items.Add($exitItem)

    $notifyIcon.ContextMenuStrip = $contextMenu

    $notifyIcon.Add_DoubleClick({
        [System.Diagnostics.Process]::Start("http://localhost:" + $port)
    })

    # 5. Rafraichissement
    function Update-Status {
        $isUp = Get-DaemonHealth
        if ($isUp) {
            $notifyIcon.Text = "Nexus Agent - En ligne"
            $statusItem.Text = "[OK] En ligne (Port " + $port + ")"
            $statusItem.ForeColor = [System.Drawing.Color]::Green
            $toggleDaemonItem.Text = "Arreter le demon"
            $openWebItem.Enabled = $true
        } else {
            $notifyIcon.Text = "Nexus Agent - Arrete"
            $statusItem.Text = "[OFF] Demon arrete"
            $statusItem.ForeColor = [System.Drawing.Color]::Gray
            $toggleDaemonItem.Text = "Demarrer le demon"
            $openWebItem.Enabled = $false
        }
    }

    Start-NexusDaemon

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 4000
    $timer.Add_Tick({
        Update-Status
    })
    $timer.Start()

    Update-Status
    Log-Message "NotifyIcon affiche dans la barre des taches. Pret."

    try {
        $notifyIcon.ShowBalloonTip(
            3000,
            "Nexus Agent Actif",
            "Nexus tourne en arriere-plan sur le port " + $port + ".",
            [System.Windows.Forms.ToolTipIcon]::Info
        )
    } catch {}

    [System.Windows.Forms.Application]::Run()

} catch {
    Log-Message "ERREUR FATALE : $_`n$($_.ScriptStackTrace)"
    [System.Windows.Forms.MessageBox]::Show(
        "Erreur dans NexusTray :`n$_`n`nConsultez $logFile pour plus de details.",
        "Nexus Tray Erreur",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
} finally {
    if ($timer) { $timer.Stop() }
    if ($notifyIcon) {
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
    }
    if ($mutex) {
        try {
            $mutex.ReleaseMutex()
            $mutex.Dispose()
        } catch {}
    }
    Log-Message "NexusTray termine."
}
