from flask import Flask, request, jsonify
from models import db, Schedule

app = Flask(__name__)

@app.route('/api/schedules', methods=['POST'])
def create_schedule():
    data = request.get_json()
    salon_id = data['salon_id']
    start_time = data['start_time']
    end_time = data['end_time']

    new_schedule = Schedule(salon_id=salon_id, start_time=start_time, end_time=end_time)
    db.session.add(new_schedule)
    db.session.commit()

    return jsonify({'message': 'Schedule created successfully'}), 201

@app.route('/api/schedules/<int:schedule_id>', methods=['PUT'])
def update_schedule(schedule_id):
    data = request.get_json()
    schedule = Schedule.query.get_or_404(schedule_id)

    schedule.start_time = data['start_time']
    schedule.end_time = data['end_time']
    schedule.is_available = data['is_available']

    db.session.commit()

    return jsonify({'message': 'Schedule updated successfully'}), 200

@app.route('/api/schedules/<int:schedule_id>', methods=['DELETE'])
def delete_schedule(schedule_id):
    schedule = Schedule.query.get_or_404(schedule_id)
    db.session.delete(schedule)
    db.session.commit()

    return jsonify({'message': 'Schedule deleted successfully'}), 200