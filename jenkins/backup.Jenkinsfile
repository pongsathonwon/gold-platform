// gold-platform nightly database backup. Replaces Cloud SQL's automated backups. docs/DEPLOY.md section 4.
//
// Jenkins job: a plain Pipeline (not multibranch), "Pipeline script from SCM", branch main,
// Script Path jenkins/backup.Jenkinsfile. Run it once by hand so Jenkins registers the trigger.
//
// Two copies of every dump:
//   - on the droplet, BACKUP_DIR, the last KEEP_DAYS days: fast to restore from
//   - archived on the Jenkins controller (a different machine, in-house), kept by buildDiscarder: survives
//     losing the droplet. The dump holds the whole ledger and the password hashes, so restrict who can
//     read this job (Configure -> enable project-based security) to the people who may restore it.
//
// What this does NOT replace: Cloud SQL's point-in-time recovery. The worst case is now losing up to a
// day of entries (since the last 02:00 dump), not minutes. docs/DEPLOY.md section 4 has the options.
pipeline {
    agent { label 'g99' }

    // 02:00 in Bangkok: after the midnight confirm sweep, before the shop opens
    triggers { cron('TZ=Asia/Bangkok\nH(0-14) 2 * * *') }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))
        skipDefaultCheckout()
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        DEPLOY_DIR = '/home/dev/jenkins-deploy/prod/gold-platform'
        BACKUP_DIR = '/home/dev/backups/gold-platform'
        KEEP_DAYS  = '14'
    }

    stages {
        stage('Dump') {
            steps {
                sh '''
                    set -e
                    GOLD="$DEPLOY_DIR/gold.sh"
                    [ -x "$GOLD" ] || { echo "$GOLD missing: has the gold-platform main branch deployed yet?"; exit 1; }
                    rm -rf backup && mkdir -p backup
                    FILE="backup/gold_platform-$(date -u +%Y%m%dT%H%MZ).dump"

                    # custom format: compressed, and restorable table by table with pg_restore
                    "$GOLD" exec -T postgres pg_dump -U gold_app -d gold_platform -Fc > "$FILE"

                    # a dump that cannot be listed cannot be restored: fail now, not on the day it is needed
                    "$GOLD" exec -T postgres pg_restore --list < "$FILE" > backup/toc.txt
                    TABLES=$(grep -c ' TABLE DATA ' backup/toc.txt || true)
                    [ "$TABLES" -gt 0 ] || { echo "dump has no table data"; exit 1; }
                    echo "dump ok: $FILE, $(du -h "$FILE" | cut -f1), $TABLES tables with data"

                    umask 077
                    mkdir -p "$BACKUP_DIR"
                    cp "$FILE" "$BACKUP_DIR/"
                    find "$BACKUP_DIR" -name 'gold_platform-*.dump' -mtime +"$KEEP_DAYS" -delete
                    echo "on host: $(ls "$BACKUP_DIR" | wc -l) dumps in $BACKUP_DIR"
                '''
                archiveArtifacts artifacts: 'backup/*.dump', fingerprint: true
            }
        }
    }

    post {
        always { cleanWs() }
    }
}
