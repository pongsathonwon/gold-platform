// gold-platform nightly confirm sweep: closes the day's wholesale edit window. Replaces the Cloud Scheduler
// job gold-confirm-sweep-nightly + Cloud Run job gold-confirm-sweep. docs/DEPLOY.md section 5.
//
// Jenkins job: a plain Pipeline (not multibranch), "Pipeline script from SCM", branch main,
// Script Path jenkins/confirm-sweep.Jenkinsfile. Run it once by hand: Jenkins only registers the
// `triggers` below after the first run.
//
// It runs the image that is live (gold-platform-api:current) against the live database, through the
// same gold.sh the deploy uses. Idempotent: a re-run or a double fire confirms nothing twice.
//
// Keep the schedule and WHOLESALE_*_AUTO_CONFIRM_HOUR (in /etc/gold-platform/prod.env) in agreement:
// the cron decides when the window actually closes, the env vars only decide what the UI says about it.
pipeline {
    agent { label 'g99' }

    // Jenkins' own TZ line, so it is midnight in the shop whatever zone the controller runs in.
    // H(0-4): Jenkins spreads load inside the first five minutes; the window closes within it.
    triggers { cron('TZ=Asia/Bangkok\nH(0-4) 0 * * *') }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '60'))
        skipDefaultCheckout()
        timeout(time: 10, unit: 'MINUTES')
    }

    environment {
        DEPLOY_DIR = '/home/dev/jenkins-deploy/prod/gold-platform'
    }

    stages {
        stage('Confirm sweep') {
            steps {
                sh '''
                    set -e
                    [ -x "$DEPLOY_DIR/gold.sh" ] || { echo "$DEPLOY_DIR/gold.sh missing: has the gold-platform main branch deployed yet?"; exit 1; }
                    "$DEPLOY_DIR/gold.sh" run --rm --no-deps api node dist/scripts/confirm-sweep.js
                '''
            }
        }
    }
}
