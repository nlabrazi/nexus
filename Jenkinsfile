@Library('nabster-ci') _

pipeline {
    agent {
        docker {
            image 'node:24'
        }
    }

    stages {
        stage('Notify start') {
            steps {
                notifyTelegram('started')
            }
        }

        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Typecheck') {
            steps {
                sh 'npm run check-types'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
            }
        }

        stage('Unit tests') {
            steps {
                sh 'npm run test:unit'
            }
        }

        stage('Package') {
            steps {
                sh 'npm run package'
            }
        }
    }

    post {
        success {
            notifyTelegram('success')
        }

        failure {
            notifyTelegram('failed')
        }
    }
}
