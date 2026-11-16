from apscheduler.schedulers.background import BackgroundScheduler

from .schedules import validate_schedule


class TaskScheduler:
    def __init__(self, database, executor):
        self.database = database
        self.executor = executor
        self.scheduler = BackgroundScheduler(
            job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60}
        )

    def start(self):
        self.scheduler.start()
        for task in self.database.list_tasks():
            if task["enabled"]:
                self.add(task)

    def add(self, task):
        self.scheduler.add_job(
            self.executor.submit,
            trigger=validate_schedule(task["cron"], task["timezone"]),
            id=task["id"],
            args=[task["id"], "scheduled"],
            replace_existing=True,
        )

    def remove(self, task_id):
        if self.scheduler.get_job(task_id):
            self.scheduler.remove_job(task_id)

    def sync(self, task):
        if task["enabled"]:
            self.add(task)
        else:
            self.remove(task["id"])

    def next_run_time(self, task_id):
        job = self.scheduler.get_job(task_id)
        return job.next_run_time.isoformat() if job and job.next_run_time else None

    def shutdown(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
